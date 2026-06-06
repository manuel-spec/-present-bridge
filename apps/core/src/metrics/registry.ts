import type { Counter } from "./counter.js";
import type { Gauge } from "./gauge.js";
import type { Histogram } from "./histogram.js";
import {
  MetricsError,
  buildQualifiedName,
  validateMetricName,
  type HistogramSample,
  type MetricDescriptor,
  type MetricSample,
  type MetricType,
} from "./types.js";

/** Union of all registerable metric instrument types. */
export type MetricInstrument = Counter | Gauge | Histogram;

/** Snapshot of all metrics collected from a registry. */
export interface RegistrySnapshot {
  readonly collectedAtMs: number;
  readonly metricCount: number;
  readonly samples: readonly MetricSample[];
  readonly histograms: readonly HistogramSample[];
}

/** Options for creating a metric registry instance. */
export interface RegistryOptions {
  /** Default namespace applied to metrics without explicit namespace. */
  readonly defaultNamespace?: string;
  /** Default subsystem applied to metrics without explicit subsystem. */
  readonly defaultSubsystem?: string;
  /** When true, duplicate registration throws instead of returning existing. */
  readonly strictMode?: boolean;
}

/**
 * Central registry for all application metrics.
 * Ensures unique metric names and provides unified collection.
 */
export class MetricRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly descriptors = new Map<string, MetricDescriptor>();
  private readonly defaultNamespace?: string;
  private readonly defaultSubsystem?: string;
  private readonly strictMode: boolean;

  constructor(options: RegistryOptions = {}) {
    this.defaultNamespace = options.defaultNamespace;
    this.defaultSubsystem = options.defaultSubsystem;
    this.strictMode = options.strictMode ?? false;
  }

  /** Registers a counter metric. Returns existing metric if already registered (unless strict). */
  registerCounter(counter: Counter): Counter {
    return this.register("counter", counter, this.counters);
  }

  /** Registers a gauge metric. */
  registerGauge(gauge: Gauge): Gauge {
    return this.register("gauge", gauge, this.gauges);
  }

  /** Registers a histogram metric. */
  registerHistogram(histogram: Histogram): Histogram {
    return this.register("histogram", histogram, this.histograms);
  }

  /** Retrieves a counter by qualified name. */
  getCounter(name: string): Counter | undefined {
    return this.counters.get(this.resolveName(name));
  }

  /** Retrieves a gauge by qualified name. */
  getGauge(name: string): Gauge | undefined {
    return this.gauges.get(this.resolveName(name));
  }

  /** Retrieves a histogram by qualified name. */
  getHistogram(name: string): Histogram | undefined {
    return this.histograms.get(this.resolveName(name));
  }

  /** Returns a metric descriptor by qualified name. */
  getDescriptor(name: string): MetricDescriptor | undefined {
    return this.descriptors.get(this.resolveName(name));
  }

  /** Checks whether a metric with the given name is registered. */
  has(name: string): boolean {
    const resolved = this.resolveName(name);
    return this.descriptors.has(resolved);
  }

  /** Returns the total number of registered metrics. */
  size(): number {
    return this.descriptors.size;
  }

  /** Lists all registered metric descriptors. */
  listDescriptors(): MetricDescriptor[] {
    return [...this.descriptors.values()];
  }

  /** Lists descriptors filtered by metric type. */
  listByType(type: MetricType): MetricDescriptor[] {
    return this.listDescriptors().filter((descriptor) => descriptor.type === type);
  }

  /** Removes a metric from the registry by name. */
  unregister(name: string): boolean {
    const resolved = this.resolveName(name);
    const descriptor = this.descriptors.get(resolved);
    if (!descriptor) {
      return false;
    }
    this.descriptors.delete(resolved);
    switch (descriptor.type) {
      case "counter":
        this.counters.delete(resolved);
        break;
      case "gauge":
        this.gauges.delete(resolved);
        break;
      case "histogram":
        this.histograms.delete(resolved);
        break;
      default:
        break;
    }
    return true;
  }

  /** Clears all registered metrics. */
  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.descriptors.clear();
  }

  /** Collects samples from all registered metrics. */
  collect(): RegistrySnapshot {
    const samples: MetricSample[] = [];
    const histograms: HistogramSample[] = [];

    for (const counter of this.counters.values()) {
      samples.push(...counter.collect());
    }
    for (const gauge of this.gauges.values()) {
      samples.push(...gauge.collect());
    }
    for (const histogram of this.histograms.values()) {
      histograms.push(...histogram.collect());
    }

    return {
      collectedAtMs: Date.now(),
      metricCount: this.descriptors.size,
      samples: Object.freeze(samples),
      histograms: Object.freeze(histograms),
    };
  }

  /** Collects only counter and gauge samples (excludes histograms). */
  collectSamples(): MetricSample[] {
    return [...this.collect().samples];
  }

  /** Collects only histogram samples. */
  collectHistograms(): HistogramSample[] {
    return [...this.collect().histograms];
  }

  /** Returns the number of time series across all metrics. */
  totalSeriesCount(): number {
    let count = 0;
    for (const counter of this.counters.values()) {
      count += counter.seriesCount();
    }
    for (const gauge of this.gauges.values()) {
      count += gauge.seriesCount();
    }
    for (const histogram of this.histograms.values()) {
      count += histogram.seriesCount();
    }
    return count;
  }

  /** Resets all counter, gauge, and histogram values without unregistering. */
  resetAll(): void {
    for (const counter of this.counters.values()) {
      counter.reset();
    }
    for (const gauge of this.gauges.values()) {
      gauge.reset();
    }
    for (const histogram of this.histograms.values()) {
      histogram.clear();
    }
  }

  /** Merges another registry's metrics into this one (strict mode applies). */
  merge(other: MetricRegistry): void {
    for (const counter of other.counters.values()) {
      this.registerCounter(counter);
    }
    for (const gauge of other.gauges.values()) {
      this.registerGauge(gauge);
    }
    for (const histogram of other.histograms.values()) {
      this.registerHistogram(histogram);
    }
  }

  private register<T extends MetricInstrument>(
    type: MetricType,
    metric: T,
    store: Map<string, T>,
  ): T {
    const qualifiedName = metric.descriptor.qualifiedName;
    this.assertValidRegistration(qualifiedName);

    const existing = store.get(qualifiedName);
    if (existing) {
      if (this.strictMode) {
        throw new MetricsError("DUPLICATE_METRIC", `Metric already registered: ${qualifiedName}`);
      }
      return existing;
    }

    const conflicting = this.descriptors.get(qualifiedName);
    if (conflicting && conflicting.type !== type) {
      throw new MetricsError(
        "DUPLICATE_METRIC",
        `Metric name ${qualifiedName} already registered as ${conflicting.type}`,
      );
    }

    store.set(qualifiedName, metric);
    this.descriptors.set(qualifiedName, metric.descriptor);
    return metric;
  }

  private resolveName(name: string): string {
    const validation = validateMetricName(name);
    if (!validation.valid && !name.includes("_")) {
      return buildQualifiedName(name, this.defaultNamespace, this.defaultSubsystem);
    }
    return name;
  }

  private assertValidRegistration(name: string): void {
    const validation = validateMetricName(name);
    if (!validation.valid) {
      throw new MetricsError("INVALID_METRIC_NAME", validation.error ?? "Invalid metric name");
    }
  }
}

/** Global default registry singleton for convenience. */
let defaultRegistry: MetricRegistry | undefined;

/** Returns the shared default metric registry, creating it on first access. */
export function getDefaultRegistry(): MetricRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new MetricRegistry({ defaultNamespace: "packet_bridge" });
  }
  return defaultRegistry;
}

/** Replaces the shared default registry (primarily for testing). */
export function setDefaultRegistry(registry: MetricRegistry): void {
  defaultRegistry = registry;
}

/** Resets the shared default registry to a fresh instance. */
export function resetDefaultRegistry(): MetricRegistry {
  defaultRegistry = new MetricRegistry({ defaultNamespace: "packet_bridge" });
  return defaultRegistry;
}

/** Creates a registry pre-loaded with standard bridge-packet metrics. */
export function createApplicationRegistry(): MetricRegistry {
  return new MetricRegistry({
    defaultNamespace: "packet_bridge",
    strictMode: true,
  });
}
