/**
 * Type definitions for the bridge-packet admin and diagnostics subsystem.
 */

/** Severity level for diagnostic findings. */
export type DiagnosticSeverity = "info" | "warning" | "error" | "critical";

/** Overall health status derived from diagnostic checks. */
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

/** A single diagnostic finding with optional remediation guidance. */
export interface DiagnosticFinding {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly component: string;
  readonly remediation?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** CPU utilization snapshot. */
export interface CpuDiagnostics {
  readonly coreCount: number;
  readonly model: string;
  readonly speedMhz: number;
  readonly loadAverage1m: number;
  readonly loadAverage5m: number;
  readonly loadAverage15m: number;
  readonly utilizationPercent: number;
}

/** Memory utilization snapshot. */
export interface MemoryDiagnostics {
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly heapTotalBytes: number;
  readonly externalBytes: number;
  readonly arrayBuffersBytes: number;
  readonly systemTotalBytes: number;
  readonly systemFreeBytes: number;
  readonly heapUsedPercent: number;
}

/** Network interface diagnostic entry. */
export interface NetworkInterfaceDiagnostics {
  readonly name: string;
  readonly address: string;
  readonly netmask: string;
  readonly family: string;
  readonly internal: boolean;
  readonly mac: string;
  readonly cidr: number | null;
}

/** Process and host server diagnostics. */
export interface ServerDiagnosticsSnapshot {
  readonly collectedAtMs: number;
  readonly hostname: string;
  readonly platform: string;
  readonly arch: string;
  readonly nodeVersion: string;
  readonly pid: number;
  readonly uptimeSeconds: number;
  readonly startTimeMs: number;
  readonly cpu: CpuDiagnostics;
  readonly memory: MemoryDiagnostics;
  readonly networkInterfaces: readonly NetworkInterfaceDiagnostics[];
}

/** mediasoup worker resource usage. */
export interface WorkerResourceUsage {
  readonly ruUtime: number;
  readonly ruStime: number;
  readonly ruMaxRss: number;
  readonly ruIxrss: number;
  readonly ruIdrss: number;
  readonly ruIsrss: number;
  readonly ruMinflt: number;
  readonly ruMajflt: number;
  readonly ruNswap: number;
  readonly ruInblock: number;
  readonly ruOublock: number;
  readonly ruMsgsnd: number;
  readonly ruMsgrcv: number;
  readonly ruNsignals: number;
  readonly ruNvcsw: number;
  readonly ruNivcsw: number;
}

/** Diagnostic snapshot for a single mediasoup worker. */
export interface WorkerDiagnosticsEntry {
  readonly workerIndex: number;
  readonly pid: number;
  readonly alive: boolean;
  readonly resourceUsage: WorkerResourceUsage | null;
  readonly error?: string;
}

/** Aggregate mediasoup worker diagnostics. */
export interface WorkerDiagnosticsSnapshot {
  readonly collectedAtMs: number;
  readonly workerCount: number;
  readonly aliveCount: number;
  readonly workers: readonly WorkerDiagnosticsEntry[];
}

/** Peer-level diagnostic detail. */
export interface PeerDiagnosticEntry {
  readonly peerId: string;
  readonly displayName: string;
  readonly roomId: string | null;
  readonly socketOpen: boolean;
  readonly transportCount: number;
  readonly producerCount: number;
  readonly consumerCount: number;
  readonly hasActiveMedia: boolean;
}

/** Room-level diagnostic detail. */
export interface RoomDiagnosticEntry {
  readonly roomId: string;
  readonly peerCount: number;
  readonly createdAt: string;
  readonly ageSeconds: number;
  readonly peers: readonly PeerDiagnosticEntry[];
}

/** Room inspection snapshot. */
export interface RoomInspectionSnapshot {
  readonly collectedAtMs: number;
  readonly totalRooms: number;
  readonly totalPeers: number;
  readonly rooms: readonly RoomDiagnosticEntry[];
}

/** Peer inspection snapshot across all rooms. */
export interface PeerInspectionSnapshot {
  readonly collectedAtMs: number;
  readonly totalPeers: number;
  readonly peersWithMedia: number;
  readonly peersWithoutRoom: number;
  readonly peers: readonly PeerDiagnosticEntry[];
}

/** Combined diagnostics from all subsystems. */
export interface AggregatedDiagnostics {
  readonly collectedAtMs: number;
  readonly status: HealthStatus;
  readonly findings: readonly DiagnosticFinding[];
  readonly server: ServerDiagnosticsSnapshot;
  readonly workers: WorkerDiagnosticsSnapshot;
  readonly rooms: RoomInspectionSnapshot;
  readonly peers: PeerInspectionSnapshot;
}

/** Options for diagnostic collection. */
export interface DiagnosticsOptions {
  readonly includeNetworkInterfaces?: boolean;
  readonly includeWorkerStats?: boolean;
  readonly includeRoomDetails?: boolean;
  readonly includePeerDetails?: boolean;
  readonly maxRooms?: number;
  readonly maxPeersPerRoom?: number;
}

/** Default diagnostic collection options. */
export const DEFAULT_DIAGNOSTICS_OPTIONS: Required<DiagnosticsOptions> = {
  includeNetworkInterfaces: true,
  includeWorkerStats: true,
  includeRoomDetails: true,
  includePeerDetails: true,
  maxRooms: 100,
  maxPeersPerRoom: 50,
} as const;

/** Error thrown by admin subsystem operations. */
export class AdminError extends Error {
  readonly code: AdminErrorCode;

  constructor(code: AdminErrorCode, message: string) {
    super(message);
    this.name = "AdminError";
    this.code = code;
  }
}

export type AdminErrorCode =
  | "COLLECTION_FAILED"
  | "WORKER_UNAVAILABLE"
  | "ROOM_NOT_FOUND"
  | "PEER_NOT_FOUND"
  | "INVALID_OPTIONS";

/** Provider interface for mediasoup worker access without modifying WorkerPool. */
export interface WorkerProvider {
  getWorkers(): Array<{
    pid: number;
    getResourceUsage(): Promise<WorkerResourceUsage>;
  }>;
}

/** Maps diagnostic severity to numeric priority for sorting. */
export function severityPriority(severity: DiagnosticSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
    default:
      return 1;
  }
}

/** Derives overall health status from findings. */
export function deriveHealthStatus(findings: readonly DiagnosticFinding[]): HealthStatus {
  if (findings.some((f) => f.severity === "critical" || f.severity === "error")) {
    return "unhealthy";
  }
  if (findings.some((f) => f.severity === "warning")) {
    return "degraded";
  }
  return "healthy";
}

/** Sorts findings by severity descending. */
export function sortFindingsBySeverity(findings: DiagnosticFinding[]): DiagnosticFinding[] {
  return [...findings].sort(
    (a, b) => severityPriority(b.severity) - severityPriority(a.severity),
  );
}

/** Formats byte count as human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Calculates age in seconds from an ISO timestamp. */
export function ageSecondsFromIso(isoTimestamp: string, nowMs = Date.now()): number {
  const created = Date.parse(isoTimestamp);
  if (Number.isNaN(created)) {
    return 0;
  }
  return Math.max(0, (nowMs - created) / 1000);
}

/** Type guard for DiagnosticFinding. */
export function isDiagnosticFinding(value: unknown): value is DiagnosticFinding {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const finding = value as DiagnosticFinding;
  return (
    typeof finding.code === "string" &&
    typeof finding.severity === "string" &&
    typeof finding.message === "string" &&
    typeof finding.component === "string"
  );
}
