import type { RoomService } from "../domain/room/room-service.js";
import { MetricsCollector, type CollectorSnapshot, type MetricsCollectorDeps } from "./metrics-collector.js";
import { formatHealthMetric, formatRegistrySnapshot, prometheusContentType } from "./prometheus-formatter.js";
import {
  MetricRegistry,
  createApplicationRegistry,
  getDefaultRegistry,
  type RegistrySnapshot,
} from "./registry.js";
import { Counter } from "./counter.js";
import { Gauge } from "./gauge.js";
import { Histogram } from "./histogram.js";
import { MetricsError } from "./types.js";

/** Configuration for the public metrics service API. */
export interface MetricsServiceOptions {
  readonly roomService: RoomService;
  readonly registry?: MetricRegistry;
  readonly version?: string;
  readonly startTimeMs?: number;
  readonly autoInitialize?: boolean;
}

/** Response returned by the metrics scrape endpoint handler. */
export interface MetricsScrapeResponse {
  readonly body: string;
  readonly contentType: string;
  readonly collectedAtMs: number;
  readonly metricCount: number;
}

/** Summary of metrics service state for health and admin endpoints. */
export interface MetricsServiceStatus {
  readonly initialized: boolean;
  readonly registrySize: number;
  readonly totalSeries: number;
  readonly lastCollectedAtMs: number | null;
  readonly version: string;
  readonly uptimeSeconds: number;
}

/**
 * Public API for the packet-bridge metrics subsystem.
 * Coordinates registry, collector, and Prometheus formatting.
 */
export class MetricsService {
  private readonly registry: MetricRegistry;
  private readonly collector: MetricsCollector;
  private readonly version: string;
  private readonly startTimeMs: number;
  private lastCollectedAtMs: number | null = null;
  private initialized = false;

  constructor(options: MetricsServiceOptions) {
    this.registry = options.registry ?? createApplicationRegistry();
    this.version = options.version ?? "unknown";
    this.startTimeMs = options.startTimeMs ?? Date.now();

    const collectorDeps: MetricsCollectorDeps = {
      roomService: options.roomService,
      registry: this.registry,
      version: this.version,
      startTimeMs: this.startTimeMs,
    };
    this.collector = new MetricsCollector(collectorDeps);

    if (options.autoInitialize !== false) {
      this.initialize();
    }
  }

  /** Initializes the metrics service and registers standard metrics. */
  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.collector.initialize();
    this.registerBuiltInMetrics();
    this.initialized = true;
  }

  /** Returns the underlying metric registry for custom instrument registration. */
  getRegistry(): MetricRegistry {
    return this.registry;
  }

  /** Returns the metrics collector for event recording. */
  getCollector(): MetricsCollector {
    return this.collector;
  }

  /** Registers a custom counter with the service registry. */
  registerCounter(counter: Counter): Counter {
    this.initialize();
    return this.registry.registerCounter(counter);
  }

  /** Registers a custom gauge with the service registry. */
  registerGauge(gauge: Gauge): Gauge {
    this.initialize();
    return this.registry.registerGauge(gauge);
  }

  /** Registers a custom histogram with the service registry. */
  registerHistogram(histogram: Histogram): Histogram {
    this.initialize();
    return this.registry.registerHistogram(histogram);
  }

  /** Collects fresh metrics and returns a registry snapshot. */
  collect(): RegistrySnapshot {
    this.initialize();
    this.collector.collect();
    const snapshot = this.registry.collect();
    this.lastCollectedAtMs = snapshot.collectedAtMs;
    return snapshot;
  }

  /** Collects application-level metrics without full registry export. */
  collectApplicationMetrics(): CollectorSnapshot {
    this.initialize();
    const snapshot = this.collector.collect();
    this.lastCollectedAtMs = snapshot.collectedAtMs;
    return snapshot;
  }

  /** Produces a Prometheus text exposition scrape response. */
  scrape(): MetricsScrapeResponse {
    const snapshot = this.collect();
    return {
      body: formatRegistrySnapshot(snapshot),
      contentType: prometheusContentType(),
      collectedAtMs: snapshot.collectedAtMs,
      metricCount: snapshot.metricCount,
    };
  }

  /** Produces a minimal health/up metric response. */
  scrapeHealth(up = true): MetricsScrapeResponse {
    return {
      body: formatHealthMetric(up),
      contentType: prometheusContentType(),
      collectedAtMs: Date.now(),
      metricCount: 1,
    };
  }

  /** Returns current service status for admin diagnostics. */
  getStatus(): MetricsServiceStatus {
    return {
      initialized: this.initialized,
      registrySize: this.registry.size(),
      totalSeries: this.registry.totalSeriesCount(),
      lastCollectedAtMs: this.lastCollectedAtMs,
      version: this.version,
      uptimeSeconds: (Date.now() - this.startTimeMs) / 1000,
    };
  }

  /** Records a peer join through the collector. */
  onPeerJoined(): void {
    this.collector.recordPeerJoined();
  }

  /** Records a peer leave through the collector. */
  onPeerLeft(): void {
    this.collector.recordPeerLeft();
  }

  /** Records HTTP request timing for the request duration histogram. */
  onHttpRequest(method: string, route: string, status: number, durationMs: number): void {
    this.collector.recordRequestDuration(method, route, status, durationMs / 1000);
  }

  /** Resets all metric values without destroying registration. */
  reset(): void {
    this.registry.resetAll();
    this.lastCollectedAtMs = null;
  }

  /** Clears all metrics and re-initializes the service. */
  restart(): void {
    this.registry.clear();
    this.initialized = false;
    this.lastCollectedAtMs = null;
    this.initialize();
  }

  private registerBuiltInMetrics(): void {
    const upGauge = new Gauge("up", {
      namespace: "packet_bridge",
      help: "Whether the packet-bridge server is running",
    });
    upGauge.set(1);
    this.registry.registerGauge(upGauge);

    const infoGauge = new Gauge("build_info", {
      namespace: "packet_bridge",
      help: "Build information",
      labelNames: ["version"],
    });
    infoGauge.set({ version: this.version }, 1);
    this.registry.registerGauge(infoGauge);
  }
}

/** Creates a metrics service using the shared default registry. */
export function createMetricsService(options: MetricsServiceOptions): MetricsService {
  return new MetricsService(options);
}

/** Creates a metrics service bound to the process-wide default registry. */
export function createDefaultMetricsService(roomService: RoomService, version?: string): MetricsService {
  return new MetricsService({
    roomService,
    registry: getDefaultRegistry(),
    version,
  });
}

/** Validates that a metric name is available for registration. */
export function assertMetricAvailable(registry: MetricRegistry, name: string): void {
  if (registry.has(name)) {
    throw new MetricsError("DUPLICATE_METRIC", `Metric already exists: ${name}`);
  }
}

/** Formats a registry snapshot as Prometheus text (convenience export). */
export { formatRegistrySnapshot, prometheusContentType };
