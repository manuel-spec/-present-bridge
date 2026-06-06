import os from "node:os";
import type { RoomService } from "../domain/room/room-service.js";
import { Counter } from "./counter.js";
import { Gauge } from "./gauge.js";
import { Histogram } from "./histogram.js";
import { DEFAULT_SIZE_BUCKETS, DEFAULT_LATENCY_BUCKETS } from "./types.js";
import type { MetricRegistry } from "./registry.js";

/** Dependencies required by the metrics collector. */
export interface MetricsCollectorDeps {
  readonly roomService: RoomService;
  readonly registry: MetricRegistry;
  readonly version?: string;
  readonly startTimeMs?: number;
}

/** Snapshot of collected application metrics before registry export. */
export interface CollectorSnapshot {
  readonly collectedAtMs: number;
  readonly system: SystemMetricsSnapshot;
  readonly rooms: RoomMetricsSnapshot;
  readonly peers: PeerMetricsSnapshot;
}

export interface SystemMetricsSnapshot {
  readonly uptimeSeconds: number;
  readonly memoryRssBytes: number;
  readonly memoryHeapUsedBytes: number;
  readonly memoryHeapTotalBytes: number;
  readonly memoryExternalBytes: number;
  readonly cpuCount: number;
  readonly loadAverage: readonly number[];
  readonly platform: string;
  readonly nodeVersion: string;
}

export interface RoomMetricsSnapshot {
  readonly activeRoomCount: number;
  readonly totalPeerCount: number;
  readonly averagePeersPerRoom: number;
  readonly largestRoomPeerCount: number;
}

export interface PeerMetricsSnapshot {
  readonly connectedPeerCount: number;
  readonly peersWithMedia: number;
  readonly totalTransports: number;
  readonly totalProducers: number;
  readonly totalConsumers: number;
}

/** Standard metric names registered by the collector. */
export const COLLECTOR_METRIC_NAMES = {
  uptime: "process_uptime_seconds",
  memoryRss: "process_resident_memory_bytes",
  memoryHeapUsed: "process_heap_used_bytes",
  memoryHeapTotal: "process_heap_total_bytes",
  roomsActive: "rooms_active_total",
  peersConnected: "peers_connected_total",
  peersJoined: "peers_joined_total",
  peersLeft: "peers_left_total",
  roomPeerCount: "room_peer_count",
  peerTransports: "peer_transports_active",
  peerProducers: "peer_producers_active",
  peerConsumers: "peer_consumers_active",
  requestDuration: "http_request_duration_seconds",
} as const;

/**
 * Collects system, room, and peer metrics into the metric registry.
 * Designed to be invoked periodically or on-demand before scraping.
 */
export class MetricsCollector {
  private readonly roomService: RoomService;
  private readonly registry: MetricRegistry;
  private readonly version: string;
  private readonly startTimeMs: number;

  private readonly uptimeGauge: Gauge;
  private readonly memoryRssGauge: Gauge;
  private readonly memoryHeapUsedGauge: Gauge;
  private readonly memoryHeapTotalGauge: Gauge;
  private readonly roomsActiveGauge: Gauge;
  private readonly peersConnectedGauge: Gauge;
  private readonly peersJoinedCounter: Counter;
  private readonly peersLeftCounter: Counter;
  private readonly roomPeerCountGauge: Gauge;
  private readonly peerTransportsGauge: Gauge;
  private readonly peerProducersGauge: Gauge;
  private readonly peerConsumersGauge: Gauge;
  private readonly requestDurationHistogram: Histogram;

  private initialized = false;

  constructor(deps: MetricsCollectorDeps) {
    this.roomService = deps.roomService;
    this.registry = deps.registry;
    this.version = deps.version ?? "unknown";
    this.startTimeMs = deps.startTimeMs ?? Date.now();

    const ns = { namespace: "packet_bridge" };

    this.uptimeGauge = new Gauge(COLLECTOR_METRIC_NAMES.uptime, {
      ...ns,
      help: "Process uptime in seconds",
    });
    this.memoryRssGauge = new Gauge(COLLECTOR_METRIC_NAMES.memoryRss, {
      ...ns,
      help: "Resident set size in bytes",
    });
    this.memoryHeapUsedGauge = new Gauge(COLLECTOR_METRIC_NAMES.memoryHeapUsed, {
      ...ns,
      help: "V8 heap used in bytes",
    });
    this.memoryHeapTotalGauge = new Gauge(COLLECTOR_METRIC_NAMES.memoryHeapTotal, {
      ...ns,
      help: "V8 heap total in bytes",
    });
    this.roomsActiveGauge = new Gauge(COLLECTOR_METRIC_NAMES.roomsActive, {
      ...ns,
      help: "Number of active rooms",
    });
    this.peersConnectedGauge = new Gauge(COLLECTOR_METRIC_NAMES.peersConnected, {
      ...ns,
      help: "Number of connected peers",
    });
    this.peersJoinedCounter = new Counter(COLLECTOR_METRIC_NAMES.peersJoined, {
      ...ns,
      help: "Total number of peers that joined rooms",
    });
    this.peersLeftCounter = new Counter(COLLECTOR_METRIC_NAMES.peersLeft, {
      ...ns,
      help: "Total number of peers that left rooms",
    });
    this.roomPeerCountGauge = new Gauge(COLLECTOR_METRIC_NAMES.roomPeerCount, {
      ...ns,
      help: "Number of peers in a room",
      labelNames: ["room_id"],
    });
    this.peerTransportsGauge = new Gauge(COLLECTOR_METRIC_NAMES.peerTransports, {
      ...ns,
      help: "Active WebRTC transports per peer",
      labelNames: ["room_id", "peer_id"],
    });
    this.peerProducersGauge = new Gauge(COLLECTOR_METRIC_NAMES.peerProducers, {
      ...ns,
      help: "Active media producers per peer",
      labelNames: ["room_id", "peer_id"],
    });
    this.peerConsumersGauge = new Gauge(COLLECTOR_METRIC_NAMES.peerConsumers, {
      ...ns,
      help: "Active media consumers per peer",
      labelNames: ["room_id", "peer_id"],
    });
    this.requestDurationHistogram = new Histogram(COLLECTOR_METRIC_NAMES.requestDuration, {
      ...ns,
      help: "HTTP request duration in seconds",
      labelNames: ["method", "route", "status"],
      buckets: DEFAULT_LATENCY_BUCKETS,
    });
  }

  /** Registers all collector metrics with the registry (idempotent). */
  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.registry.registerGauge(this.uptimeGauge);
    this.registry.registerGauge(this.memoryRssGauge);
    this.registry.registerGauge(this.memoryHeapUsedGauge);
    this.registry.registerGauge(this.memoryHeapTotalGauge);
    this.registry.registerGauge(this.roomsActiveGauge);
    this.registry.registerGauge(this.peersConnectedGauge);
    this.registry.registerCounter(this.peersJoinedCounter);
    this.registry.registerCounter(this.peersLeftCounter);
    this.registry.registerGauge(this.roomPeerCountGauge);
    this.registry.registerGauge(this.peerTransportsGauge);
    this.registry.registerGauge(this.peerProducersGauge);
    this.registry.registerGauge(this.peerConsumersGauge);
    this.registry.registerHistogram(this.requestDurationHistogram);
    this.initialized = true;
  }

  /** Records a peer join event. */
  recordPeerJoined(): void {
    this.peersJoinedCounter.inc();
  }

  /** Records a peer leave event. */
  recordPeerLeft(): void {
    this.peersLeftCounter.inc();
  }

  /** Records an HTTP request duration observation. */
  recordRequestDuration(method: string, route: string, status: number, durationSeconds: number): void {
    this.requestDurationHistogram.observe(
      { method, route, status: String(status) },
      durationSeconds,
    );
  }

  /** Refreshes all gauge values from current system and application state. */
  collect(): CollectorSnapshot {
    this.initialize();

    const system = this.collectSystemMetrics();
    const rooms = this.collectRoomMetrics();
    const peers = this.collectPeerMetrics();

    this.uptimeGauge.set(system.uptimeSeconds);
    this.memoryRssGauge.set(system.memoryRssBytes);
    this.memoryHeapUsedGauge.set(system.memoryHeapUsedBytes);
    this.memoryHeapTotalGauge.set(system.memoryHeapTotalBytes);
    this.roomsActiveGauge.set(rooms.activeRoomCount);
    this.peersConnectedGauge.set(peers.connectedPeerCount);

    this.roomPeerCountGauge.reset();
    for (const room of this.roomService.listRooms()) {
      this.roomPeerCountGauge.set({ room_id: room.roomId }, room.peerCount);
    }

    this.peerTransportsGauge.reset();
    this.peerProducersGauge.reset();
    this.peerConsumersGauge.reset();
    this.updatePeerMediaGauges();

    return {
      collectedAtMs: Date.now(),
      system,
      rooms,
      peers,
    };
  }

  getVersion(): string {
    return this.version;
  }

  getStartTimeMs(): number {
    return this.startTimeMs;
  }

  private collectSystemMetrics(): SystemMetricsSnapshot {
    const memory = process.memoryUsage();
    return {
      uptimeSeconds: (Date.now() - this.startTimeMs) / 1000,
      memoryRssBytes: memory.rss,
      memoryHeapUsedBytes: memory.heapUsed,
      memoryHeapTotalBytes: memory.heapTotal,
      memoryExternalBytes: memory.external,
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg(),
      platform: process.platform,
      nodeVersion: process.version,
    };
  }

  private collectRoomMetrics(): RoomMetricsSnapshot {
    const rooms = this.roomService.listRooms();
    const peerCounts = rooms.map((room) => room.peerCount);
    const totalPeerCount = peerCounts.reduce((sum, count) => sum + count, 0);
    const activeRoomCount = rooms.length;

    return {
      activeRoomCount,
      totalPeerCount,
      averagePeersPerRoom: activeRoomCount > 0 ? totalPeerCount / activeRoomCount : 0,
      largestRoomPeerCount: peerCounts.length > 0 ? Math.max(...peerCounts) : 0,
    };
  }

  private collectPeerMetrics(): PeerMetricsSnapshot {
    let connectedPeerCount = 0;
    let peersWithMedia = 0;
    let totalTransports = 0;
    let totalProducers = 0;
    let totalConsumers = 0;

    for (const room of this.roomService.listRooms()) {
      for (const peer of this.roomService.getPeersInRoom(room.roomId)) {
        connectedPeerCount += 1;
        try {
          const session = this.roomService.getSession(peer.peerId);
          const transportCount = session.transports.size;
          const producerCount = session.producers.size;
          const consumerCount = session.consumers.size;
          totalTransports += transportCount;
          totalProducers += producerCount;
          totalConsumers += consumerCount;
          if (transportCount > 0 || producerCount > 0 || consumerCount > 0) {
            peersWithMedia += 1;
          }
        } catch {
          // Peer may have disconnected between list and get
        }
      }
    }

    return {
      connectedPeerCount,
      peersWithMedia,
      totalTransports,
      totalProducers,
      totalConsumers,
    };
  }

  private updatePeerMediaGauges(): void {
    for (const room of this.roomService.listRooms()) {
      for (const peer of this.roomService.getPeersInRoom(room.roomId)) {
        try {
          const session = this.roomService.getSession(peer.peerId);
          const labels = { room_id: room.roomId, peer_id: peer.peerId };
          this.peerTransportsGauge.set(labels, session.transports.size);
          this.peerProducersGauge.set(labels, session.producers.size);
          this.peerConsumersGauge.set(labels, session.consumers.size);
        } catch {
          // Ignore races with disconnect
        }
      }
    }
  }
}

/** Creates a metrics collector with default bridge-packet metric definitions. */
export function createMetricsCollector(deps: MetricsCollectorDeps): MetricsCollector {
  return new MetricsCollector(deps);
}

/** Size buckets re-exported for consumers configuring custom histograms. */
export { DEFAULT_SIZE_BUCKETS };
