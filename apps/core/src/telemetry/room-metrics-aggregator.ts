import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import { BandwidthEstimator } from "./bandwidth-estimator.js";
import { ConnectionQualityScorer } from "./connection-quality-scorer.js";
import { JitterCalculator } from "./jitter-calculator.js";
import { PacketLossTracker } from "./packet-loss-tracker.js";
import type { PeerMetricsStore } from "./peer-metrics-store.js";
import type {
  ConnectionQualityGrade,
  PeerMetrics,
  PeerMetricsRecord,
  RoomMetrics,
  TelemetryConfig,
} from "./types.js";
import { gradeFromScore } from "./types.js";

export interface RoomAggregationOptions {
  config: TelemetryConfig;
  store: PeerMetricsStore;
}

export interface RoomAggregationResult {
  roomId: string;
  metrics: RoomMetrics;
  peers: PeerMetrics[];
}

export interface MultiRoomAggregation {
  rooms: RoomMetrics[];
  allPeers: PeerMetrics[];
  assessedAt: number;
}

function emptyQualityDistribution(): Record<ConnectionQualityGrade, number> {
  return {
    excellent: 0,
    good: 0,
    fair: 0,
    poor: 0,
    critical: 0,
  };
}

export class RoomMetricsAggregator {
  private readonly config: TelemetryConfig;
  private readonly store: PeerMetricsStore;
  private readonly bandwidthEstimator: BandwidthEstimator;
  private readonly packetLossTracker: PacketLossTracker;
  private readonly jitterCalculator: JitterCalculator;
  private readonly qualityScorer: ConnectionQualityScorer;

  constructor(options: RoomAggregationOptions) {
    this.config = options.config;
    this.store = options.store;
    const windowMs = options.config.rollingWindow.windowMs;

    this.bandwidthEstimator = new BandwidthEstimator({ windowMs });
    this.packetLossTracker = new PacketLossTracker({ windowMs });
    this.jitterCalculator = new JitterCalculator({ windowMs });
    this.qualityScorer = new ConnectionQualityScorer(options.config.qualityWeights);
  }

  aggregateRoom(roomId: string, now: number = Date.now()): RoomAggregationResult {
    const records = this.store.list({ roomId, includeStale: true });
    const peers = records.map((record) => this.buildPeerMetrics(record, now));
    const metrics = this.computeRoomMetrics(roomId, peers, now);

    return { roomId, metrics, peers };
  }

  aggregateAllRooms(now: number = Date.now()): MultiRoomAggregation {
    const roomIds = this.listRoomIds();
    const rooms: RoomMetrics[] = [];
    const allPeers: PeerMetrics[] = [];

    for (const roomId of roomIds) {
      const result = this.aggregateRoom(roomId, now);
      rooms.push(result.metrics);
      allPeers.push(...result.peers);
    }

    return {
      rooms,
      allPeers,
      assessedAt: now,
    };
  }

  aggregatePeer(peerId: string, now: number = Date.now()): PeerMetrics {
    const record = this.store.get(peerId);
    return this.buildPeerMetrics(record, now);
  }

  requireRoomMetrics(roomId: string, now: number = Date.now()): RoomMetrics {
    const peerCount = this.store.countByRoom(roomId);
    if (peerCount === 0) {
      throw new AppError(ErrorCode.ROOM_NOT_FOUND, `No telemetry data for room: ${roomId}`);
    }
    return this.aggregateRoom(roomId, now).metrics;
  }

  listRoomIds(): string[] {
    const records = this.store.list({ includeStale: true });
    const roomIds = new Set(records.map((record) => record.roomId));
    return [...roomIds];
  }

  topPeersByQuality(roomId: string, limit: number = 5, now: number = Date.now()): PeerMetrics[] {
    const { peers } = this.aggregateRoom(roomId, now);
    return [...peers].sort((a, b) => b.quality.score - a.quality.score).slice(0, limit);
  }

  worstPeersByQuality(roomId: string, limit: number = 5, now: number = Date.now()): PeerMetrics[] {
    const { peers } = this.aggregateRoom(roomId, now);
    return [...peers].sort((a, b) => a.quality.score - b.quality.score).slice(0, limit);
  }

  peersBelowQualityThreshold(
    roomId: string,
    minimumScore: number,
    now: number = Date.now(),
  ): PeerMetrics[] {
    const { peers } = this.aggregateRoom(roomId, now);
    return peers.filter((peer) => peer.quality.score < minimumScore);
  }

  roomBandwidthTotals(roomId: string, now: number = Date.now()): { uploadBps: number; downloadBps: number } {
    const { peers } = this.aggregateRoom(roomId, now);
    const uploadBps = peers.reduce((sum, peer) => sum + peer.upload.bitsPerSecond, 0);
    const downloadBps = peers.reduce((sum, peer) => sum + peer.download.bitsPerSecond, 0);
    return { uploadBps, downloadBps };
  }

  private buildPeerMetrics(record: PeerMetricsRecord, now: number): PeerMetrics {
    const windowMs = this.config.rollingWindow.windowMs;

    const latency = this.jitterCalculator.compute(record.latencySamples, now);
    const upload = this.bandwidthEstimator.estimate(record.bandwidthSamples, "upload", now);
    const download = this.bandwidthEstimator.estimate(record.bandwidthSamples, "download", now);
    const packetLoss = this.packetLossTracker.compute(record.packetLossSamples, now);

    const quality = this.qualityScorer.score({
      latency,
      packetLoss,
      upload,
      download,
      assessedAt: now,
    });

    const isStale = now - record.lastUpdatedAt > this.config.stalePeerThresholdMs;

    return {
      peerId: record.peerId,
      roomId: record.roomId,
      displayName: record.displayName,
      connectedAt: record.connectedAt,
      lastUpdatedAt: record.lastUpdatedAt,
      latency,
      upload,
      download,
      packetLoss,
      quality,
      isStale,
    };
  }

  private computeRoomMetrics(roomId: string, peers: PeerMetrics[], now: number): RoomMetrics {
    const activePeers = peers.filter((peer) => !peer.isStale);
    const qualities = peers.map((peer) => peer.quality);
    const qualityDistribution = emptyQualityDistribution();

    for (const peer of peers) {
      qualityDistribution[peer.quality.grade] += 1;
    }

    const aggregateUploadBps = peers.reduce((sum, peer) => sum + peer.upload.bitsPerSecond, 0);
    const aggregateDownloadBps = peers.reduce((sum, peer) => sum + peer.download.bitsPerSecond, 0);

    const latencyStats = peers.map((peer) => peer.latency);
    const aggregatedLatency = this.jitterCalculator.aggregateRoomJitter(latencyStats);

    const packetLossStats = peers.map((peer) => peer.packetLoss);
    const aggregatedLoss = this.packetLossTracker.aggregateRoomLoss(packetLossStats);

    const averageQualityScore = this.qualityScorer.averageScore(qualities);
    const medianQualityScore = this.qualityScorer.medianScore(qualities);
    const worstQualityScore = qualities.length > 0 ? Math.min(...qualities.map((q) => q.score)) : 0;

    return {
      roomId,
      peerCount: peers.length,
      activePeerCount: activePeers.length,
      averageQualityScore,
      medianQualityScore,
      worstQualityScore,
      aggregateUploadBps,
      aggregateDownloadBps,
      averageLatencyMs: aggregatedLatency.meanLatencyMs,
      averageJitterMs: aggregatedLatency.jitterMs,
      averagePacketLossRate: aggregatedLoss.lossRate,
      qualityDistribution,
      assessedAt: now,
    };
  }
}

export function summarizeRoomHealth(metrics: RoomMetrics): ConnectionQualityGrade {
  return gradeFromScore(metrics.averageQualityScore);
}
