import type { RoomService } from "../domain/room/room-service.js";
import { DiagnosticsAggregator, type DiagnosticsAggregatorDeps } from "./diagnostics-aggregator.js";
import { PeerInspector } from "./peer-inspector.js";
import { RoomInspector } from "./room-inspector.js";
import { ServerDiagnostics } from "./server-diagnostics.js";
import { WorkerDiagnostics } from "./worker-diagnostics.js";
import type {
  AggregatedDiagnostics,
  DiagnosticFinding,
  DiagnosticsOptions,
  HealthStatus,
  PeerDiagnosticEntry,
  PeerInspectionSnapshot,
  RoomDiagnosticEntry,
  RoomInspectionSnapshot,
  ServerDiagnosticsSnapshot,
  WorkerDiagnosticsSnapshot,
  WorkerProvider,
} from "./types.js";
import { DEFAULT_DIAGNOSTICS_OPTIONS, formatBytes } from "./types.js";

/** Configuration for the public admin service API. */
export interface AdminServiceOptions {
  readonly roomService: RoomService;
  readonly workerProvider?: WorkerProvider | null;
  readonly startTimeMs?: number;
}

/** JSON-serializable admin status response. */
export interface AdminStatusResponse {
  readonly status: HealthStatus;
  readonly uptimeSeconds: number;
  readonly version: string;
  readonly rooms: number;
  readonly peers: number;
  readonly workers: { readonly total: number; readonly alive: number };
  readonly memory: { readonly heapUsed: string; readonly rss: string };
  readonly collectedAtMs: number;
}

/**
 * Public API for the packet-bridge admin and diagnostics subsystem.
 * Provides unified access to server, worker, room, and peer inspection.
 */
export class AdminService {
  private readonly aggregator: DiagnosticsAggregator;
  private readonly serverDiagnostics: ServerDiagnostics;
  private readonly workerDiagnostics: WorkerDiagnostics;
  private readonly roomInspector: RoomInspector;
  private readonly peerInspector: PeerInspector;
  private readonly startTimeMs: number;
  private lastDiagnostics: AggregatedDiagnostics | null = null;

  constructor(options: AdminServiceOptions) {
    this.startTimeMs = options.startTimeMs ?? Date.now();

    const deps: DiagnosticsAggregatorDeps = {
      roomService: options.roomService,
      workerProvider: options.workerProvider,
      startTimeMs: this.startTimeMs,
    };

    this.aggregator = new DiagnosticsAggregator(deps);
    this.serverDiagnostics = new ServerDiagnostics({ startTimeMs: this.startTimeMs });
    this.workerDiagnostics = new WorkerDiagnostics(options.workerProvider ?? null);
    this.roomInspector = new RoomInspector(options.roomService);
    this.peerInspector = new PeerInspector(options.roomService);
  }

  /** Collects full aggregated diagnostics. */
  async getDiagnostics(options?: DiagnosticsOptions): Promise<AggregatedDiagnostics> {
    const diagnostics = await this.aggregator.collect(options);
    this.lastDiagnostics = diagnostics;
    return diagnostics;
  }

  /** Returns a compact admin status suitable for health endpoints. */
  async getStatus(options?: DiagnosticsOptions): Promise<AdminStatusResponse> {
    const diagnostics = await this.getDiagnostics(options);
    return {
      status: diagnostics.status,
      uptimeSeconds: diagnostics.server.uptimeSeconds,
      version: process.env["npm_package_version"] ?? "unknown",
      rooms: diagnostics.rooms.totalRooms,
      peers: diagnostics.peers.totalPeers,
      workers: {
        total: diagnostics.workers.workerCount,
        alive: diagnostics.workers.aliveCount,
      },
      memory: {
        heapUsed: formatBytes(diagnostics.server.memory.heapUsedBytes),
        rss: formatBytes(diagnostics.server.memory.rssBytes),
      },
      collectedAtMs: diagnostics.collectedAtMs,
    };
  }

  /** Returns current health status only. */
  async getHealthStatus(options?: DiagnosticsOptions): Promise<HealthStatus> {
    return this.aggregator.getHealthStatus(options);
  }

  /** Returns diagnostic findings sorted by severity. */
  async getFindings(options?: DiagnosticsOptions): Promise<DiagnosticFinding[]> {
    return this.aggregator.analyze(options);
  }

  /** Returns server diagnostics snapshot. */
  getServerDiagnostics(): ServerDiagnosticsSnapshot {
    return this.serverDiagnostics.collect();
  }

  /** Returns worker diagnostics snapshot. */
  async getWorkerDiagnostics(): Promise<WorkerDiagnosticsSnapshot> {
    return this.workerDiagnostics.collect();
  }

  /** Returns room inspection snapshot. */
  getRoomInspection(): RoomInspectionSnapshot {
    return this.roomInspector.collect();
  }

  /** Returns peer inspection snapshot. */
  getPeerInspection(): PeerInspectionSnapshot {
    return this.peerInspector.collect();
  }

  /** Inspects a single room by ID. */
  inspectRoom(roomId: string): RoomDiagnosticEntry {
    return this.roomInspector.inspectRoomById(roomId);
  }

  /** Inspects a single peer by ID. */
  inspectPeer(peerId: string): PeerDiagnosticEntry {
    return this.peerInspector.inspectPeer(peerId);
  }

  /** Lists all active room IDs. */
  listRoomIds(): string[] {
    return this.roomInspector.listRoomIds();
  }

  /** Returns the most recently collected diagnostics, if any. */
  getLastDiagnostics(): AggregatedDiagnostics | null {
    return this.lastDiagnostics;
  }

  /** Returns a one-line summary for logging. */
  async summarize(options?: DiagnosticsOptions): Promise<string> {
    return this.aggregator.summarize(options);
  }

  /** Checks whether the server is healthy (no error/critical findings). */
  async isHealthy(options?: DiagnosticsOptions): Promise<boolean> {
    const status = await this.getHealthStatus(options);
    return status === "healthy";
  }

  /** Returns default diagnostics options. */
  getDefaultOptions(): Required<DiagnosticsOptions> {
    return { ...DEFAULT_DIAGNOSTICS_OPTIONS };
  }

  getStartTimeMs(): number {
    return this.startTimeMs;
  }
}

export function createAdminService(options: AdminServiceOptions): AdminService {
  return new AdminService(options);
}

export type {
  AggregatedDiagnostics,
  DiagnosticFinding,
  DiagnosticsOptions,
  HealthStatus,
  PeerDiagnosticEntry,
  RoomDiagnosticEntry,
  ServerDiagnosticsSnapshot,
  WorkerDiagnosticsSnapshot,
};
