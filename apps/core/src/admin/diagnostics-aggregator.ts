import type { RoomService } from "../domain/room/room-service.js";
import { PeerInspector } from "./peer-inspector.js";
import { RoomInspector } from "./room-inspector.js";
import { ServerDiagnostics } from "./server-diagnostics.js";
import { WorkerDiagnostics } from "./worker-diagnostics.js";
import type {
  AggregatedDiagnostics,
  DiagnosticFinding,
  DiagnosticsOptions,
  HealthStatus,
  PeerInspectionSnapshot,
  RoomInspectionSnapshot,
  ServerDiagnosticsSnapshot,
  WorkerDiagnosticsSnapshot,
  WorkerProvider,
} from "./types.js";
import {
  DEFAULT_DIAGNOSTICS_OPTIONS,
  deriveHealthStatus,
  sortFindingsBySeverity,
} from "./types.js";

/** Dependencies for the diagnostics aggregator. */
export interface DiagnosticsAggregatorDeps {
  readonly roomService: RoomService;
  readonly workerProvider?: WorkerProvider | null;
  readonly startTimeMs?: number;
}

/**
 * Combines server, worker, room, and peer diagnostics into a unified snapshot.
 * Runs all collectors, merges findings, and derives overall health status.
 */
export class DiagnosticsAggregator {
  private readonly serverDiagnostics: ServerDiagnostics;
  private readonly workerDiagnostics: WorkerDiagnostics;
  private readonly roomInspector: RoomInspector;
  private readonly peerInspector: PeerInspector;

  constructor(deps: DiagnosticsAggregatorDeps) {
    const startTimeMs = deps.startTimeMs ?? Date.now();
    this.serverDiagnostics = new ServerDiagnostics({ startTimeMs });
    this.workerDiagnostics = new WorkerDiagnostics(deps.workerProvider ?? null);
    this.roomInspector = new RoomInspector(deps.roomService);
    this.peerInspector = new PeerInspector(deps.roomService);
  }

  /** Collects full aggregated diagnostics with default options. */
  async collect(options: DiagnosticsOptions = {}): Promise<AggregatedDiagnostics> {
    const resolved = { ...DEFAULT_DIAGNOSTICS_OPTIONS, ...options };
    const collectedAtMs = Date.now();

    const server = this.serverDiagnostics.collect({
      includeNetworkInterfaces: resolved.includeNetworkInterfaces,
    });

    const workers = resolved.includeWorkerStats
      ? await this.workerDiagnostics.collect()
      : this.emptyWorkerSnapshot(collectedAtMs);

    const rooms = resolved.includeRoomDetails
      ? this.roomInspector.collect()
      : this.emptyRoomSnapshot(collectedAtMs);

    const peers = resolved.includePeerDetails
      ? this.peerInspector.collect()
      : this.emptyPeerSnapshot(collectedAtMs);

    const findings = this.aggregateFindings(server, workers, rooms, peers);
    const status = deriveHealthStatus(findings);

    return {
      collectedAtMs,
      status,
      findings: Object.freeze(sortFindingsBySeverity(findings)),
      server,
      workers,
      rooms,
      peers,
    };
  }

  /** Collects only server diagnostics. */
  collectServer(options?: DiagnosticsOptions): ServerDiagnosticsSnapshot {
    return this.serverDiagnostics.collect({
      includeNetworkInterfaces: options?.includeNetworkInterfaces,
    });
  }

  /** Collects only worker diagnostics. */
  async collectWorkers(): Promise<WorkerDiagnosticsSnapshot> {
    return this.workerDiagnostics.collect();
  }

  /** Collects only room inspection data. */
  collectRooms(): RoomInspectionSnapshot {
    return this.roomInspector.collect();
  }

  /** Collects only peer inspection data. */
  collectPeers(): PeerInspectionSnapshot {
    return this.peerInspector.collect();
  }

  /** Returns findings without full snapshot collection. */
  async analyze(options: DiagnosticsOptions = {}): Promise<DiagnosticFinding[]> {
    const diagnostics = await this.collect(options);
    return [...diagnostics.findings];
  }

  /** Returns only the derived health status. */
  async getHealthStatus(options?: DiagnosticsOptions): Promise<HealthStatus> {
    const diagnostics = await this.collect(options);
    return diagnostics.status;
  }

  /** Returns a compact summary string for logging. */
  async summarize(options?: DiagnosticsOptions): Promise<string> {
    const diagnostics = await this.collect(options);
    return [
      `status=${diagnostics.status}`,
      `rooms=${diagnostics.rooms.totalRooms}`,
      `peers=${diagnostics.peers.totalPeers}`,
      `workers=${diagnostics.workers.aliveCount}/${diagnostics.workers.workerCount}`,
      `uptime=${diagnostics.server.uptimeSeconds.toFixed(0)}s`,
      `findings=${diagnostics.findings.length}`,
    ].join(" ");
  }

  /** Filters findings by component name. */
  filterFindingsByComponent(
    findings: readonly DiagnosticFinding[],
    component: string,
  ): DiagnosticFinding[] {
    return findings.filter((f) => f.component === component);
  }

  /** Filters findings by minimum severity. */
  filterFindingsByMinSeverity(
    findings: readonly DiagnosticFinding[],
    minSeverity: DiagnosticFinding["severity"],
  ): DiagnosticFinding[] {
    const priorityMap: Record<DiagnosticFinding["severity"], number> = {
      info: 1,
      warning: 2,
      error: 3,
      critical: 4,
    };
    const minPriority = priorityMap[minSeverity];
    return findings.filter((f) => priorityMap[f.severity] >= minPriority);
  }

  private aggregateFindings(
    server: ServerDiagnosticsSnapshot,
    workers: WorkerDiagnosticsSnapshot,
    rooms: RoomInspectionSnapshot,
    peers: PeerInspectionSnapshot,
  ): DiagnosticFinding[] {
    return [
      ...this.serverDiagnostics.analyze(server),
      ...this.workerDiagnostics.analyze(workers),
      ...this.roomInspector.analyze(rooms),
      ...this.peerInspector.analyze(peers),
    ];
  }

  private emptyWorkerSnapshot(collectedAtMs: number): WorkerDiagnosticsSnapshot {
    return {
      collectedAtMs,
      workerCount: 0,
      aliveCount: 0,
      workers: [],
    };
  }

  private emptyRoomSnapshot(collectedAtMs: number): RoomInspectionSnapshot {
    return {
      collectedAtMs,
      totalRooms: 0,
      totalPeers: 0,
      rooms: [],
    };
  }

  private emptyPeerSnapshot(collectedAtMs: number): PeerInspectionSnapshot {
    return {
      collectedAtMs,
      totalPeers: 0,
      peersWithMedia: 0,
      peersWithoutRoom: 0,
      peers: [],
    };
  }
}

export function createDiagnosticsAggregator(
  deps: DiagnosticsAggregatorDeps,
): DiagnosticsAggregator {
  return new DiagnosticsAggregator(deps);
}

export function hasCriticalFindings(findings: readonly DiagnosticFinding[]): boolean {
  return findings.some((f) => f.severity === "critical");
}

export function countFindingsBySeverity(
  findings: readonly DiagnosticFinding[],
): Record<DiagnosticFinding["severity"], number> {
  return {
    info: findings.filter((f) => f.severity === "info").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    error: findings.filter((f) => f.severity === "error").length,
    critical: findings.filter((f) => f.severity === "critical").length,
  };
}
