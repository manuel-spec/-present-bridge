import { buildLabelSet, requireValidLabels } from "./metric-labels.js";
import {
  MetricsError,
  buildQualifiedName,
  emptyLabels,
  labelsEqual,
  mergeLabels,
  serializeLabels,
  validateMetricName,
  type LabelSet,
  type MetricDescriptor,
  type MetricOptions,
  type MetricSample,
} from "./types.js";

/** Internal storage cell for a single gauge time series. */
interface GaugeCell {
  readonly labels: LabelSet;
  value: number;
  lastUpdatedMs: number;
}

/** Callback invoked by a gauge to compute its current value dynamically. */
export type GaugeCallback = () => number;

/**
 * Gauge metric representing a value that can arbitrarily rise and fall.
 * Supports labeled dimensions, set/inc/dec operations, and callback collection.
 */
export class Gauge {
  readonly descriptor: MetricDescriptor;
  private readonly cells = new Map<string, GaugeCell>();
  private readonly labelNames: readonly string[];
  private readonly callbacks: GaugeCallback[] = [];

  constructor(name: string, options: MetricOptions) {
    const nameValidation = validateMetricName(name);
    if (!nameValidation.valid) {
      throw new MetricsError("INVALID_METRIC_NAME", nameValidation.error ?? "Invalid metric name");
    }

    this.labelNames = Object.freeze([...(options.labelNames ?? [])]);
    const qualifiedName = buildQualifiedName(name, options.namespace, options.subsystem);

    this.descriptor = Object.freeze({
      name,
      type: "gauge",
      help: options.help,
      labelNames: this.labelNames,
      qualifiedName,
    });
  }

  get name(): string {
    return this.descriptor.qualifiedName;
  }

  /** Sets the gauge to an absolute value. */
  set(labelsOrValue: LabelSet | number, maybeValue?: number): void {
    if (typeof labelsOrValue === "number") {
      this.setWithLabels(emptyLabels(), labelsOrValue);
      return;
    }
    const labels = labelsOrValue ?? emptyLabels();
    const value = maybeValue ?? 0;
    this.setWithLabels(labels, value);
  }

  /** Sets the gauge for a specific label set. */
  setWithLabels(labels: LabelSet, value: number): void {
    this.assertFinite(value);
    const sanitized = requireValidLabels(labels, this.labelNames.length > 0 ? this.labelNames : undefined);
    const key = serializeLabels(sanitized);
    const existing = this.cells.get(key);
    if (existing) {
      existing.value = value;
      existing.lastUpdatedMs = Date.now();
      return;
    }
    this.cells.set(key, { labels: sanitized, value, lastUpdatedMs: Date.now() });
  }

  /** Increments the gauge by the given amount (default 1). */
  inc(labelsOrAmount?: LabelSet | number, maybeAmount?: number): void {
    if (typeof labelsOrAmount === "number") {
      this.adjust(emptyLabels(), labelsOrAmount);
      return;
    }
    const labels = labelsOrAmount ?? emptyLabels();
    const amount = maybeAmount ?? 1;
    this.adjust(labels, amount);
  }

  /** Decrements the gauge by the given amount (default 1). */
  dec(labelsOrAmount?: LabelSet | number, maybeAmount?: number): void {
    if (typeof labelsOrAmount === "number") {
      this.adjust(emptyLabels(), -labelsOrAmount);
      return;
    }
    const labels = labelsOrAmount ?? emptyLabels();
    const amount = maybeAmount ?? 1;
    this.adjust(labels, -amount);
  }

  /** Adjusts the gauge by a signed delta. */
  adjust(labels: LabelSet, delta: number): void {
    this.assertFinite(delta);
    const current = this.get(labels);
    this.setWithLabels(labels, current + delta);
  }

  /** Returns the current gauge value. */
  get(): number;
  get(labels: LabelSet): number;
  get(labels?: LabelSet): number {
    const resolved = labels ?? emptyLabels();
    const sanitized = requireValidLabels(resolved, this.labelNames.length > 0 ? this.labelNames : undefined);
    return this.cells.get(serializeLabels(sanitized))?.value ?? 0;
  }

  /** Sets the gauge to zero for a series (or all series). */
  reset(labels?: LabelSet): void {
    if (labels === undefined) {
      for (const cell of this.cells.values()) {
        cell.value = 0;
        cell.lastUpdatedMs = Date.now();
      }
      return;
    }
    this.setWithLabels(labels, 0);
  }

  /** Registers a callback whose result is published as an unlabeled sample on collect. */
  addCallback(callback: GaugeCallback): void {
    this.callbacks.push(callback);
  }

  /** Removes a previously registered callback. */
  removeCallback(callback: GaugeCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  clear(): void {
    this.cells.clear();
    this.callbacks.length = 0;
  }

  seriesCount(): number {
    return this.cells.size;
  }

  /** Collects all gauge samples, including callback-derived values. */
  collect(): MetricSample[] {
    const samples: MetricSample[] = [];

    for (const cell of this.cells.values()) {
      samples.push({
        name: this.descriptor.qualifiedName,
        type: "gauge",
        help: this.descriptor.help,
        labels: cell.labels,
        value: cell.value,
        timestampMs: cell.lastUpdatedMs,
      });
    }

    for (const callback of this.callbacks) {
      const value = callback();
      this.assertFinite(value);
      samples.push({
        name: this.descriptor.qualifiedName,
        type: "gauge",
        help: this.descriptor.help,
        labels: emptyLabels(),
        value,
        timestampMs: Date.now(),
      });
    }

    if (samples.length === 0 && this.labelNames.length === 0 && this.callbacks.length === 0) {
      samples.push({
        name: this.descriptor.qualifiedName,
        type: "gauge",
        help: this.descriptor.help,
        labels: emptyLabels(),
        value: 0,
      });
    }

    return samples;
  }

  labels(
    labelValuesOrFirst: Record<string, string> | string,
    ...rest: string[]
  ): LabeledGauge {
    if (typeof labelValuesOrFirst === "string") {
      return new LabeledGauge(this, buildLabelSet(this.labelNames, [labelValuesOrFirst, ...rest]));
    }
    return new LabeledGauge(this, requireValidLabels(labelValuesOrFirst, this.labelNames));
  }

  withDefaultLabels(defaults: LabelSet): Gauge {
    const gauge = new Gauge(this.descriptor.name, {
      help: this.descriptor.help,
      labelNames: this.labelNames,
    });
    const originalSet = gauge.setWithLabels.bind(gauge);
    gauge.setWithLabels = (labels: LabelSet, value: number) => {
      originalSet(mergeLabels(defaults, labels), value);
    };
    return gauge;
  }

  hasSeries(labels: LabelSet): boolean {
    const sanitized = requireValidLabels(labels, this.labelNames.length > 0 ? this.labelNames : undefined);
    return this.cells.has(serializeLabels(sanitized));
  }

  labelSets(): LabelSet[] {
    return [...this.cells.values()].map((cell) => cell.labels);
  }

  private assertFinite(value: number): void {
    if (!Number.isFinite(value)) {
      throw new MetricsError("INVALID_LABELS", "Gauge value must be a finite number");
    }
  }
}

/** A gauge view bound to a fixed label set. */
export class LabeledGauge {
  constructor(
    private readonly parent: Gauge,
    private readonly labels: LabelSet,
  ) {}

  set(value: number): void {
    this.parent.setWithLabels(this.labels, value);
  }

  inc(amount = 1): void {
    this.parent.adjust(this.labels, amount);
  }

  dec(amount = 1): void {
    this.parent.adjust(this.labels, -amount);
  }

  get(): number {
    return this.parent.get(this.labels);
  }

  reset(): void {
    this.parent.reset(this.labels);
  }

  getLabelSet(): LabelSet {
    return this.labels;
  }

  equals(other: LabeledGauge): boolean {
    return this.parent === other.parent && labelsEqual(this.labels, other.labels);
  }
}

export function createGauge(name: string, help: string, labelNames?: readonly string[]): Gauge {
  return new Gauge(name, { help, labelNames });
}

export function totalGaugeValue(gauge: Gauge): number {
  return gauge.collect().reduce((sum, sample) => sum + sample.value, 0);
}

export function maxGaugeValue(gauge: Gauge): number {
  const samples = gauge.collect();
  if (samples.length === 0) {
    return 0;
  }
  return Math.max(...samples.map((sample) => sample.value));
}

export function minGaugeValue(gauge: Gauge): number {
  const samples = gauge.collect();
  if (samples.length === 0) {
    return 0;
  }
  return Math.min(...samples.map((sample) => sample.value));
}
