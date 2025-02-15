/**
 * Core telemetry type definitions for packet-bridge peer and room metrics.
 */

export const DEFAULT_ROLLING_WINDOW_MS = 30_000;
export const DEFAULT_SAMPLE_RETENTION_MS = 300_000;
export const DEFAULT_SNAPSHOT_INTERVAL_MS = 5_000;
export const MAX_SAMPLES_PER_WINDOW = 1_000;
export const MIN_BANDWIDTH_SAMPLE_INTERVAL_MS = 100;

export type ConnectionQualityGrade = "excellent" | "good" | "fair" | "poor" | "critical";

export type MetricDirection = "upload" | "download" | "bidirectional";

export type TransportKind = "audio" | "video" | "data" | "screen";

export interface RollingWindowConfig {
  windowMs: number;
  maxSamples: number;
  retentionMs: number;
}

export interface TelemetryConfig {
  rollingWindow: RollingWindowConfig;
  snapshotIntervalMs: number;
  qualityWeights: QualityWeights;
  stalePeerThresholdMs: number;
}

export interface QualityWeights {
  latency: number;
  jitter: number;
  packetLoss: number;
  bandwidth: number;
}

export interface TimestampedSample {
  timestamp: number;
}

export interface LatencySample extends TimestampedSample {
  rttMs: number;
  oneWayMs?: number;
  transportKind?: TransportKind;
}

export interface BandwidthSample extends TimestampedSample {
  direction: MetricDirection;
  bytesTransferred: number;
  intervalMs: number;
  transportKind?: TransportKind;
}

export interface PacketLossSample extends TimestampedSample {
  packetsSent: number;
  packetsReceived: number;
  packetsLost: number;
  transportKind?: TransportKind;
}

export interface ThroughputEstimate {
  direction: MetricDirection;
  bytesPerSecond: number;
  bitsPerSecond: number;
  sampleCount: number;
  windowMs: number;
  peakBytesPerSecond: number;
  trend: "rising" | "stable" | "falling";
}

export interface PacketLossStats {
  lossRate: number;
  packetsSent: number;
  packetsReceived: number;
  packetsLost: number;
  windowMs: number;
  sampleCount: number;
  transportKind?: TransportKind;
}

export interface JitterStats {
  jitterMs: number;
  meanLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  sampleCount: number;
  windowMs: number;
}

export interface ConnectionQuality {
  score: number;
  grade: ConnectionQualityGrade;
  latencyScore: number;
  jitterScore: number;
  packetLossScore: number;
  bandwidthScore: number;
  assessedAt: number;
}

export interface PeerMetrics {
  peerId: string;
  roomId: string;
  displayName?: string;
  connectedAt: number;
  lastUpdatedAt: number;
  latency: JitterStats;
  upload: ThroughputEstimate;
  download: ThroughputEstimate;
  packetLoss: PacketLossStats;
  quality: ConnectionQuality;
  isStale: boolean;
}

export interface RoomMetrics {
  roomId: string;
  peerCount: number;
  activePeerCount: number;
  averageQualityScore: number;
  medianQualityScore: number;
  worstQualityScore: number;
  aggregateUploadBps: number;
  aggregateDownloadBps: number;
  averageLatencyMs: number;
  averageJitterMs: number;
  averagePacketLossRate: number;
  qualityDistribution: Record<ConnectionQualityGrade, number>;
  assessedAt: number;
}

export interface TelemetrySnapshot {
  generatedAt: number;
  snapshotId: string;
  rooms: RoomMetrics[];
  peers: PeerMetrics[];
  totals: TelemetryTotals;
}

export interface TelemetryTotals {
  totalPeers: number;
  totalRooms: number;
  averageQualityScore: number;
  totalUploadBps: number;
  totalDownloadBps: number;
}

export interface PeerMetricsRecord {
  peerId: string;
  roomId: string;
  displayName?: string;
  connectedAt: number;
  lastUpdatedAt: number;
  latencySamples: LatencySample[];
  bandwidthSamples: BandwidthSample[];
  packetLossSamples: PacketLossSample[];
}

export interface CreatePeerMetricsInput {
  peerId: string;
  roomId: string;
  displayName?: string;
  connectedAt?: number;
}

export interface RecordLatencyInput {
  peerId: string;
  rttMs: number;
  oneWayMs?: number;
  transportKind?: TransportKind;
  timestamp?: number;
}

export interface RecordBandwidthInput {
  peerId: string;
  direction: MetricDirection;
  bytesTransferred: number;
  intervalMs: number;
  transportKind?: TransportKind;
  timestamp?: number;
}

export interface RecordPacketLossInput {
  peerId: string;
  packetsSent: number;
  packetsReceived: number;
  packetsLost?: number;
  transportKind?: TransportKind;
  timestamp?: number;
}

export interface UpdatePeerInput {
  displayName?: string;
  roomId?: string;
}

export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
  latency: 0.3,
  jitter: 0.25,
  packetLoss: 0.3,
  bandwidth: 0.15,
};

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  rollingWindow: {
    windowMs: DEFAULT_ROLLING_WINDOW_MS,
    maxSamples: MAX_SAMPLES_PER_WINDOW,
    retentionMs: DEFAULT_SAMPLE_RETENTION_MS,
  },
  snapshotIntervalMs: DEFAULT_SNAPSHOT_INTERVAL_MS,
  qualityWeights: DEFAULT_QUALITY_WEIGHTS,
  stalePeerThresholdMs: 60_000,
};

export function gradeFromScore(score: number): ConnectionQualityGrade {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 55) return "fair";
  if (score >= 30) return "poor";
  return "critical";
}

export function normalizeQualityWeights(weights: Partial<QualityWeights>): QualityWeights {
  const merged: QualityWeights = {
    latency: weights.latency ?? DEFAULT_QUALITY_WEIGHTS.latency,
    jitter: weights.jitter ?? DEFAULT_QUALITY_WEIGHTS.jitter,
    packetLoss: weights.packetLoss ?? DEFAULT_QUALITY_WEIGHTS.packetLoss,
    bandwidth: weights.bandwidth ?? DEFAULT_QUALITY_WEIGHTS.bandwidth,
  };

  const total = merged.latency + merged.jitter + merged.packetLoss + merged.bandwidth;
  if (total <= 0) {
    return { ...DEFAULT_QUALITY_WEIGHTS };
  }

  return {
    latency: merged.latency / total,
    jitter: merged.jitter / total,
    packetLoss: merged.packetLoss / total,
    bandwidth: merged.bandwidth / total,
  };
}

export function mergeTelemetryConfig(partial?: Partial<TelemetryConfig>): TelemetryConfig {
  if (!partial) {
    return { ...DEFAULT_TELEMETRY_CONFIG };
  }

  return {
    rollingWindow: {
      windowMs: partial.rollingWindow?.windowMs ?? DEFAULT_TELEMETRY_CONFIG.rollingWindow.windowMs,
      maxSamples: partial.rollingWindow?.maxSamples ?? DEFAULT_TELEMETRY_CONFIG.rollingWindow.maxSamples,
      retentionMs: partial.rollingWindow?.retentionMs ?? DEFAULT_TELEMETRY_CONFIG.rollingWindow.retentionMs,
    },
    snapshotIntervalMs: partial.snapshotIntervalMs ?? DEFAULT_TELEMETRY_CONFIG.snapshotIntervalMs,
    qualityWeights: normalizeQualityWeights(partial.qualityWeights ?? {}),
    stalePeerThresholdMs: partial.stalePeerThresholdMs ?? DEFAULT_TELEMETRY_CONFIG.stalePeerThresholdMs,
  };
}

export function isValidLatencySample(sample: LatencySample): boolean {
  return (
    Number.isFinite(sample.timestamp) &&
    Number.isFinite(sample.rttMs) &&
    sample.rttMs >= 0 &&
    (sample.oneWayMs === undefined || (Number.isFinite(sample.oneWayMs) && sample.oneWayMs >= 0))
  );
}

export function isValidBandwidthSample(sample: BandwidthSample): boolean {
  return (
    Number.isFinite(sample.timestamp) &&
    Number.isFinite(sample.bytesTransferred) &&
    sample.bytesTransferred >= 0 &&
    Number.isFinite(sample.intervalMs) &&
    sample.intervalMs >= MIN_BANDWIDTH_SAMPLE_INTERVAL_MS
  );
}

export function isValidPacketLossSample(sample: PacketLossSample): boolean {
  const lost = sample.packetsLost ?? sample.packetsSent - sample.packetsReceived;
  return (
    Number.isFinite(sample.timestamp) &&
    Number.isFinite(sample.packetsSent) &&
    Number.isFinite(sample.packetsReceived) &&
    sample.packetsSent >= 0 &&
    sample.packetsReceived >= 0 &&
    lost >= 0 &&
    sample.packetsReceived + lost <= sample.packetsSent + 1
  );
}

export function emptyThroughputEstimate(direction: MetricDirection, windowMs: number): ThroughputEstimate {
  return {
    direction,
    bytesPerSecond: 0,
    bitsPerSecond: 0,
    sampleCount: 0,
    windowMs,
    peakBytesPerSecond: 0,
    trend: "stable",
  };
}

export function emptyPacketLossStats(windowMs: number): PacketLossStats {
  return {
    lossRate: 0,
    packetsSent: 0,
    packetsReceived: 0,
    packetsLost: 0,
    windowMs,
    sampleCount: 0,
  };
}

export function emptyJitterStats(windowMs: number): JitterStats {
  return {
    jitterMs: 0,
    meanLatencyMs: 0,
    minLatencyMs: 0,
    maxLatencyMs: 0,
    sampleCount: 0,
    windowMs,
  };
}

export function emptyConnectionQuality(assessedAt: number): ConnectionQuality {
  return {
    score: 0,
    grade: "critical",
    latencyScore: 0,
    jitterScore: 0,
    packetLossScore: 0,
    bandwidthScore: 0,
    assessedAt,
  };
}

export function createEmptyPeerMetricsRecord(input: CreatePeerMetricsInput): PeerMetricsRecord {
  const now = input.connectedAt ?? Date.now();
  return {
    peerId: input.peerId,
    roomId: input.roomId,
    displayName: input.displayName,
    connectedAt: now,
    lastUpdatedAt: now,
    latencySamples: [],
    bandwidthSamples: [],
    packetLossSamples: [],
  };
}
