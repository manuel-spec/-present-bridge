import { buildLabelSet, requireValidLabels } from "./metric-labels.js";
import {
  DEFAULT_LATENCY_BUCKETS,
  MetricsError,
  buildQualifiedName,
  emptyLabels,
  labelsEqual,
  mergeLabels,
  serializeLabels,
  validateMetricName,
  type HistogramBucket,
  type HistogramOptions,
  type HistogramSample,
  type LabelSet,
  type MetricDescriptor,
} from "./types.js";

/** Internal accumulator for a single histogram time series. */
interface HistogramCell {
  readonly labels: LabelSet;
  readonly bucketBounds: readonly number[];
  readonly bucketCounts: number[];
  sum: number;
  count: number;
}

/**
 * Histogram metric with configurable bucket boundaries.
 * Tracks observation counts per bucket plus sum and total count.
 */
export class Histogram {
  readonly descriptor: MetricDescriptor;
  private readonly bucketBounds: readonly number[];
  private readonly cells = new Map<string, HistogramCell>();
  private readonly labelNames: readonly string[];

  constructor(name: string, options: HistogramOptions) {
    const nameValidation = validateMetricName(name);
    if (!nameValidation.valid) {
      throw new MetricsError("INVALID_METRIC_NAME", nameValidation.error ?? "Invalid metric name");
    }

    this.labelNames = Object.freeze([...(options.labelNames ?? [])]);
    const qualifiedName = buildQualifiedName(name, options.namespace, options.subsystem);
    this.bucketBounds = Object.freeze([...(options.buckets ?? DEFAULT_LATENCY_BUCKETS)]);

    if (this.bucketBounds.length === 0) {
      throw new MetricsError("INVALID_METRIC_NAME", "Histogram must have at least one bucket boundary");
    }

    for (let index = 1; index < this.bucketBounds.length; index += 1) {
      if (this.bucketBounds[index]! <= this.bucketBounds[index - 1]!) {
        throw new MetricsError(
          "INVALID_METRIC_NAME",
          "Histogram bucket boundaries must be strictly increasing",
        );
      }
    }

    this.descriptor = Object.freeze({
      name,
      type: "histogram",
      help: options.help,
      labelNames: this.labelNames,
      qualifiedName,
    });
  }

  get name(): string {
    return this.descriptor.qualifiedName;
  }

  get buckets(): readonly number[] {
    return this.bucketBounds;
  }

  /** Records an observation into the histogram. */
  observe(labelsOrValue: LabelSet | number, maybeValue?: number): void {
    if (typeof labelsOrValue === "number") {
      this.observeWithLabels(emptyLabels(), labelsOrValue);
      return;
    }
    const labels = labelsOrValue ?? emptyLabels();
    const value = maybeValue ?? 0;
    this.observeWithLabels(labels, value);
  }

  /** Records an observation for a specific label set. */
  observeWithLabels(labels: LabelSet, value: number): void {
    this.assertValidObservation(value);
    const sanitized = requireValidLabels(labels, this.labelNames.length > 0 ? this.labelNames : undefined);
    const key = serializeLabels(sanitized);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = this.createCell(sanitized);
      this.cells.set(key, cell);
    }
    this.recordObservation(cell, value);
  }

  /** Returns total observation count for a series. */
  getCount(): number;
  getCount(labels: LabelSet): number;
  getCount(labels?: LabelSet): number {
    const resolved = labels ?? emptyLabels();
    const sanitized = requireValidLabels(resolved, this.labelNames.length > 0 ? this.labelNames : undefined);
    return this.cells.get(serializeLabels(sanitized))?.count ?? 0;
  }

  /** Returns sum of all observations for a series. */
  getSum(): number;
  getSum(labels: LabelSet): number;
  getSum(labels?: LabelSet): number {
    const resolved = labels ?? emptyLabels();
    const sanitized = requireValidLabels(resolved, this.labelNames.length > 0 ? this.labelNames : undefined);
    return this.cells.get(serializeLabels(sanitized))?.sum ?? 0;
  }

  /** Returns cumulative bucket counts for a series. */
  getBucketCounts(labels?: LabelSet): HistogramBucket[] {
    const resolved = labels ?? emptyLabels();
    const sanitized = requireValidLabels(resolved, this.labelNames.length > 0 ? this.labelNames : undefined);
    const cell = this.cells.get(serializeLabels(sanitized));
    if (!cell) {
      return this.emptyBuckets();
    }
    return this.toBucketArray(cell);
  }

  reset(labels?: LabelSet): void {
    if (labels === undefined) {
      this.cells.clear();
      return;
    }
    const sanitized = requireValidLabels(labels, this.labelNames.length > 0 ? this.labelNames : undefined);
    this.cells.delete(serializeLabels(sanitized));
  }

  clear(): void {
    this.cells.clear();
  }

  seriesCount(): number {
    return this.cells.size;
  }

  /** Collects histogram samples for Prometheus export. */
  collect(): HistogramSample[] {
    const samples: HistogramSample[] = [];
    for (const cell of this.cells.values()) {
      samples.push({
        name: this.descriptor.qualifiedName,
        help: this.descriptor.help,
        labels: cell.labels,
        buckets: this.toBucketArray(cell),
        sum: cell.sum,
        count: cell.count,
      });
    }
    if (samples.length === 0 && this.labelNames.length === 0) {
      const emptyCell = this.createCell(emptyLabels());
      samples.push({
        name: this.descriptor.qualifiedName,
        help: this.descriptor.help,
        labels: emptyLabels(),
        buckets: this.toBucketArray(emptyCell),
        sum: 0,
        count: 0,
      });
    }
    return samples;
  }

  labels(
    labelValuesOrFirst: Record<string, string> | string,
    ...rest: string[]
  ): LabeledHistogram {
    if (typeof labelValuesOrFirst === "string") {
      return new LabeledHistogram(this, buildLabelSet(this.labelNames, [labelValuesOrFirst, ...rest]));
    }
    return new LabeledHistogram(this, requireValidLabels(labelValuesOrFirst, this.labelNames));
  }

  withDefaultLabels(defaults: LabelSet): Histogram {
    const histogram = new Histogram(this.descriptor.name, {
      help: this.descriptor.help,
      labelNames: this.labelNames,
      buckets: this.bucketBounds,
    });
    const originalObserve = histogram.observeWithLabels.bind(histogram);
    histogram.observeWithLabels = (labels: LabelSet, value: number) => {
      originalObserve(mergeLabels(defaults, labels), value);
    };
    return histogram;
  }

  hasSeries(labels: LabelSet): boolean {
    const sanitized = requireValidLabels(labels, this.labelNames.length > 0 ? this.labelNames : undefined);
    return this.cells.has(serializeLabels(sanitized));
  }

  labelSets(): LabelSet[] {
    return [...this.cells.values()].map((cell) => cell.labels);
  }

  private createCell(labels: LabelSet): HistogramCell {
    return {
      labels,
      bucketBounds: this.bucketBounds,
      bucketCounts: new Array(this.bucketBounds.length).fill(0),
      sum: 0,
      count: 0,
    };
  }

  private recordObservation(cell: HistogramCell, value: number): void {
    cell.sum += value;
    cell.count += 1;
    for (let index = 0; index < cell.bucketBounds.length; index += 1) {
      if (value <= cell.bucketBounds[index]!) {
        cell.bucketCounts[index]! += 1;
      }
    }
  }

  private toBucketArray(cell: HistogramCell): HistogramBucket[] {
    const buckets: HistogramBucket[] = [];
    let cumulative = 0;
    for (let index = 0; index < cell.bucketBounds.length; index += 1) {
      cumulative += cell.bucketCounts[index]!;
      buckets.push({ le: cell.bucketBounds[index]!, count: cumulative });
    }
    buckets.push({ le: "+Inf", count: cell.count });
    return buckets;
  }

  private emptyBuckets(): HistogramBucket[] {
    const buckets: HistogramBucket[] = this.bucketBounds.map((bound) => ({ le: bound, count: 0 }));
    buckets.push({ le: "+Inf", count: 0 });
    return buckets;
  }

  private assertValidObservation(value: number): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new MetricsError("INVALID_LABELS", "Histogram observations must be non-negative finite numbers");
    }
  }
}

/** A histogram view bound to a fixed label set. */
export class LabeledHistogram {
  constructor(
    private readonly parent: Histogram,
    private readonly labels: LabelSet,
  ) {}

  observe(value: number): void {
    this.parent.observeWithLabels(this.labels, value);
  }

  getCount(): number {
    return this.parent.getCount(this.labels);
  }

  getSum(): number {
    return this.parent.getSum(this.labels);
  }

  getBucketCounts(): HistogramBucket[] {
    return this.parent.getBucketCounts(this.labels);
  }

  reset(): void {
    this.parent.reset(this.labels);
  }

  getLabelSet(): LabelSet {
    return this.labels;
  }

  equals(other: LabeledHistogram): boolean {
    return this.parent === other.parent && labelsEqual(this.labels, other.labels);
  }
}

export function createHistogram(
  name: string,
  help: string,
  options?: { labelNames?: readonly string[]; buckets?: readonly number[] },
): Histogram {
  return new Histogram(name, {
    help,
    labelNames: options?.labelNames,
    buckets: options?.buckets,
  });
}

export function histogramMean(histogram: Histogram, labels?: LabelSet): number {
  const resolvedLabels = labels ?? {};
  const count = histogram.getCount(resolvedLabels);
  if (count === 0) {
    return 0;
  }
  return histogram.getSum(resolvedLabels) / count;
}
