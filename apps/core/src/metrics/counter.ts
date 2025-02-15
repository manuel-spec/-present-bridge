import { buildLabelSet, requireValidLabels } from "./metric-labels.js";
import {
  MetricsError,
  assertLabelNames,
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

/** Internal storage cell for a single counter time series. */
interface CounterCell {
  readonly labels: LabelSet;
  value: number;
}

/**
 * Monotonic counter metric. Values may only increase (or be reset to zero).
 * Supports multi-dimensional labels and efficient per-series storage.
 */
export class Counter {
  readonly descriptor: MetricDescriptor;
  private readonly cells = new Map<string, CounterCell>();
  private readonly labelNames: readonly string[];

  constructor(name: string, options: MetricOptions) {
    const nameValidation = validateMetricName(name);
    if (!nameValidation.valid) {
      throw new MetricsError("INVALID_METRIC_NAME", nameValidation.error ?? "Invalid metric name");
    }

    this.labelNames = Object.freeze([...(options.labelNames ?? [])]);
    const qualifiedName = buildQualifiedName(name, options.namespace, options.subsystem);

    this.descriptor = Object.freeze({
      name,
      type: "counter",
      help: options.help,
      labelNames: this.labelNames,
      qualifiedName,
    });
  }

  /** Returns the fully-qualified Prometheus metric name. */
  get name(): string {
    return this.descriptor.qualifiedName;
  }

  /** Increments the counter by the given amount (default 1). */
  inc(labelsOrAmount?: LabelSet | number, maybeAmount?: number): void {
    if (typeof labelsOrAmount === "number") {
      this.incWithLabels(emptyLabels(), labelsOrAmount);
      return;
    }
    const labels = labelsOrAmount ?? emptyLabels();
    const amount = maybeAmount ?? 1;
    this.incWithLabels(labels, amount);
  }

  /** Increments the counter for a specific label set. */
  incWithLabels(labels: LabelSet, amount = 1): void {
    this.assertPositiveIncrement(amount);
    const sanitized = requireValidLabels(labels, this.labelNames.length > 0 ? this.labelNames : undefined);
    const key = serializeLabels(sanitized);
    const existing = this.cells.get(key);
    if (existing) {
      existing.value += amount;
      return;
    }
    this.cells.set(key, { labels: sanitized, value: amount });
  }

  /** Returns the current value for an unlabeled counter. */
  get(): number;
  /** Returns the current value for a labeled counter series. */
  get(labels: LabelSet): number;
  get(labels?: LabelSet): number {
    const resolved = labels ?? emptyLabels();
    const sanitized = requireValidLabels(resolved, this.labelNames.length > 0 ? this.labelNames : undefined);
    return this.cells.get(serializeLabels(sanitized))?.value ?? 0;
  }

  /** Resets a specific series (or all series) to zero. */
  reset(labels?: LabelSet): void {
    if (labels === undefined) {
      for (const cell of this.cells.values()) {
        cell.value = 0;
      }
      return;
    }
    const sanitized = requireValidLabels(labels, this.labelNames.length > 0 ? this.labelNames : undefined);
    const cell = this.cells.get(serializeLabels(sanitized));
    if (cell) {
      cell.value = 0;
    }
  }

  /** Removes all stored time series from the counter. */
  clear(): void {
    this.cells.clear();
  }

  /** Returns the number of distinct label combinations tracked. */
  seriesCount(): number {
    return this.cells.size;
  }

  /** Collects all counter samples for export. */
  collect(): MetricSample[] {
    const samples: MetricSample[] = [];
    for (const cell of this.cells.values()) {
      samples.push({
        name: this.descriptor.qualifiedName,
        type: "counter",
        help: this.descriptor.help,
        labels: cell.labels,
        value: cell.value,
      });
    }
    if (samples.length === 0 && this.labelNames.length === 0) {
      samples.push({
        name: this.descriptor.qualifiedName,
        type: "counter",
        help: this.descriptor.help,
        labels: emptyLabels(),
        value: 0,
      });
    }
    return samples;
  }

  /** Creates a labeled child counter bound to fixed label values. */
  labels(
    labelValuesOrFirst: Record<string, string> | string,
    ...rest: string[]
  ): LabeledCounter {
    if (typeof labelValuesOrFirst === "string") {
      return new LabeledCounter(this, buildLabelSet(this.labelNames, [labelValuesOrFirst, ...rest]));
    }
    return new LabeledCounter(this, requireValidLabels(labelValuesOrFirst, this.labelNames));
  }

  /** Merges default labels with call-time labels for inc/get operations. */
  withDefaultLabels(defaults: LabelSet): Counter {
    const wrapper = new Counter(this.descriptor.name, {
      help: this.descriptor.help,
      labelNames: this.labelNames,
    });
    const originalInc = wrapper.incWithLabels.bind(wrapper);
    wrapper.incWithLabels = (labels: LabelSet, amount = 1) => {
      originalInc(mergeLabels(defaults, labels), amount);
    };
    return wrapper;
  }

  /** Returns true if a series exists for the given labels. */
  hasSeries(labels: LabelSet): boolean {
    const sanitized = requireValidLabels(labels, this.labelNames.length > 0 ? this.labelNames : undefined);
    return this.cells.has(serializeLabels(sanitized));
  }

  /** Returns all distinct label sets currently stored. */
  labelSets(): LabelSet[] {
    return [...this.cells.values()].map((cell) => cell.labels);
  }

  /** Validates that provided labels match the counter schema. */
  validateLabels(labels: LabelSet): void {
    requireValidLabels(labels, this.labelNames.length > 0 ? this.labelNames : undefined);
    assertLabelNames(Object.keys(labels), this.labelNames);
  }

  private assertPositiveIncrement(amount: number): void {
    if (amount < 0) {
      throw new MetricsError("NEGATIVE_COUNTER", "Counters can only be incremented by non-negative amounts");
    }
    if (!Number.isFinite(amount)) {
      throw new MetricsError("NEGATIVE_COUNTER", "Counter increment must be a finite number");
    }
  }
}

/** A counter view bound to a fixed label set. */
export class LabeledCounter {
  constructor(
    private readonly parent: Counter,
    private readonly labels: LabelSet,
  ) {}

  inc(amount = 1): void {
    this.parent.incWithLabels(this.labels, amount);
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

  equals(other: LabeledCounter): boolean {
    return this.parent === other.parent && labelsEqual(this.labels, other.labels);
  }
}

/** Factory helper for creating counters with common defaults. */
export function createCounter(name: string, help: string, labelNames?: readonly string[]): Counter {
  return new Counter(name, { help, labelNames });
}

/** Sums all series values in a counter. */
export function totalCounterValue(counter: Counter): number {
  return counter.collect().reduce((sum, sample) => sum + sample.value, 0);
}

/** Creates a counter pre-populated with zero-valued label series. */
export function counterWithSeries(
  name: string,
  options: MetricOptions,
  series: readonly LabelSet[],
): Counter {
  const counter = new Counter(name, options);
  for (const labels of series) {
    counter.incWithLabels(labels, 0);
  }
  return counter;
}
