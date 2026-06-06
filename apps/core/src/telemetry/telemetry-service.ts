import { ErrorCode } from "@bridge-packet/shared";
import { AppError } from "../lib/errors.js";
import { BandwidthEstimator } from "./bandwidth-estimator.js";
import { ConnectionQualityScorer } from "./connection-quality-scorer.js";
import { JitterCalculator } from "./jitter-calculator.js";
import { PacketLossTracker } from "./packet-loss-tracker.js";
import { PeerMetricsStore } from "./peer-metrics-store.js";
import { RoomMetricsAggregator } from "./room-metrics-aggregator.js";
import { SnapshotBuilder } from "./snapshot-builder.js";
import type {
  CreatePeerMetricsInput,
  PeerMetrics,
  RecordBandwidthInput,
  RecordLatencyInput,
  RecordPacketLossInput,
  RoomMetrics,
  TelemetryConfig,
  TelemetrySnapshot,
  UpdatePeerInput,
} from "./types.js";
import { mergeTelemetryConfig } from "./types.js";

export interface TelemetryServiceOptions {
  config?: Partial<TelemetryConfig>;
}

export interface RegisterPeerInput extends CreatePeerMetricsInput {
  initialLatencyMs?: number;
}

export interface TelemetryServiceStats {
  peerCount: number;
  roomCount: number;
  totalSamples: number;
  lastSnapshotAt: number | null;
}

export class TelemetryService {
  private readonly config: TelemetryConfig;
  private readonly store: PeerMetricsStore;
  private readonly aggregator: RoomMetricsAggregator;
  private readonly snapshotBuilder: SnapshotBuilder;
  private readonly bandwidthEstimator: BandwidthEstimator;
  private readonly packetLossTracker: PacketLossTracker;
  private readonly jitterCalculator: JitterCalculator;
  private readonly qualityScorer: ConnectionQualityScorer;
  private lastSnapshotAt: number | null = null;

  constructor(options: TelemetryServiceOptions = {}) {
    this.config = mergeTelemetryConfig(options.config);
    this.store = new PeerMetricsStore({ rollingWindow: this.config.rollingWindow });

    this.aggregator = new RoomMetricsAggregator({
      config: this.config,
      store: this.store,
    });

    this.snapshotBuilder = new SnapshotBuilder({
      aggregator: this.aggregator,
    });

    const windowMs = this.config.rollingWindow.windowMs;
    this.bandwidthEstimator = new BandwidthEstimator({ windowMs });
    this.packetLossTracker = new PacketLossTracker({ windowMs });
    this.jitterCalculator = new JitterCalculator({ windowMs });
    this.qualityScorer = new ConnectionQualityScorer(this.config.qualityWeights);
  }

  registerPeer(input: RegisterPeerInput): PeerMetrics {
    this.store.create({
      peerId: input.peerId,
      roomId: input.roomId,
      displayName: input.displayName,
      connectedAt: input.connectedAt,
    });

    if (input.initialLatencyMs !== undefined && input.initialLatencyMs >= 0) {
      this.store.recordLatency({
        peerId: input.peerId,
        rttMs: input.initialLatencyMs,
      });
    }

    return this.aggregator.aggregatePeer(input.peerId);
  }

  unregisterPeer(peerId: string): boolean {
    return this.store.delete(peerId);
  }

  unregisterRoom(roomId: string): number {
    return this.store.deleteByRoom(roomId);
  }

  updatePeer(peerId: string, input: UpdatePeerInput): PeerMetrics {
    this.store.update(peerId, input);
    return this.aggregator.aggregatePeer(peerId);
  }

  recordLatency(input: RecordLatencyInput): PeerMetrics {
    this.store.recordLatency(input);
    return this.aggregator.aggregatePeer(input.peerId);
  }

  recordBandwidth(input: RecordBandwidthInput): PeerMetrics {
    this.store.recordBandwidth(input);
    return this.aggregator.aggregatePeer(input.peerId);
  }

  recordPacketLoss(input: RecordPacketLossInput): PeerMetrics {
    this.store.recordPacketLoss(input);
    return this.aggregator.aggregatePeer(input.peerId);
  }

  getPeerMetrics(peerId: string): PeerMetrics {
    if (!this.store.has(peerId)) {
      throw new AppError(ErrorCode.PEER_NOT_FOUND, `Peer telemetry not found: ${peerId}`);
    }
    return this.aggregator.aggregatePeer(peerId);
  }

  getRoomMetrics(roomId: string): RoomMetrics {
    return this.aggregator.requireRoomMetrics(roomId);
  }

  listRoomMetrics(): RoomMetrics[] {
    return this.aggregator.aggregateAllRooms().rooms;
  }

  listPeerMetrics(roomId?: string): PeerMetrics[] {
    const aggregation = this.aggregator.aggregateAllRooms();
    if (!roomId) {
      return aggregation.allPeers;
    }
    return aggregation.allPeers.filter((peer) => peer.roomId === roomId);
  }

  buildSnapshot(now: number = Date.now()): TelemetrySnapshot {
    const snapshot = this.snapshotBuilder.build(now);
    this.lastSnapshotAt = now;
    return snapshot;
  }

  buildRoomSnapshot(roomId: string, now: number = Date.now()): TelemetrySnapshot {
    if (this.store.countByRoom(roomId) === 0) {
      throw new AppError(ErrorCode.ROOM_NOT_FOUND, `No telemetry data for room: ${roomId}`);
    }
    const snapshot = this.snapshotBuilder.buildForRoom(roomId, now);
    this.lastSnapshotAt = now;
    return snapshot;
  }

  getPeersBelowQuality(roomId: string, minimumScore: number = 55): PeerMetrics[] {
    return this.aggregator.peersBelowQualityThreshold(roomId, minimumScore);
  }

  getTopPeers(roomId: string, limit: number = 5): PeerMetrics[] {
    return this.aggregator.topPeersByQuality(roomId, limit);
  }

  getWorstPeers(roomId: string, limit: number = 5): PeerMetrics[] {
    return this.aggregator.worstPeersByQuality(roomId, limit);
  }

  pruneStale(now: number = Date.now()): number {
    return this.store.prune(undefined, now);
  }

  clear(): void {
    this.store.clear();
    this.lastSnapshotAt = null;
  }

  stats(): TelemetryServiceStats {
    const storeStats = this.store.stats();
    return {
      peerCount: storeStats.totalPeers,
      roomCount: storeStats.totalRooms,
      totalSamples:
        storeStats.totalLatencySamples +
        storeStats.totalBandwidthSamples +
        storeStats.totalPacketLossSamples,
      lastSnapshotAt: this.lastSnapshotAt,
    };
  }

  getConfig(): TelemetryConfig {
    return {
      ...this.config,
      rollingWindow: { ...this.config.rollingWindow },
      qualityWeights: { ...this.config.qualityWeights },
    };
  }

  ensurePeer(input: CreatePeerMetricsInput): PeerMetrics {
    const record = this.store.getOrCreate(input);
    return this.aggregator.aggregatePeer(record.peerId);
  }

  hasPeer(peerId: string): boolean {
    return this.store.has(peerId);
  }

  hasRoom(roomId: string): boolean {
    return this.store.countByRoom(roomId) > 0;
  }

  recordBatch(
    peerId: string,
    batch: {
      latencies?: Array<Omit<RecordLatencyInput, "peerId">>;
      bandwidth?: Array<Omit<RecordBandwidthInput, "peerId">>;
      packetLoss?: Array<Omit<RecordPacketLossInput, "peerId">>;
    },
  ): PeerMetrics {
    if (!this.store.has(peerId)) {
      throw new AppError(ErrorCode.PEER_NOT_FOUND, `Peer telemetry not found: ${peerId}`);
    }

    if (batch.latencies) {
      for (const sample of batch.latencies) {
        this.store.recordLatency({ peerId, ...sample });
      }
    }

    if (batch.bandwidth) {
      for (const sample of batch.bandwidth) {
        this.store.recordBandwidth({ peerId, ...sample });
      }
    }

    if (batch.packetLoss) {
      for (const sample of batch.packetLoss) {
        this.store.recordPacketLoss({ peerId, ...sample });
      }
    }

    return this.aggregator.aggregatePeer(peerId);
  }

  isPeerStale(peerId: string, now: number = Date.now()): boolean {
    const metrics = this.getPeerMetrics(peerId);
    return now - metrics.lastUpdatedAt > this.config.stalePeerThresholdMs;
  }

  getBandwidthEstimator(): BandwidthEstimator {
    return this.bandwidthEstimator;
  }

  getPacketLossTracker(): PacketLossTracker {
    return this.packetLossTracker;
  }

  getJitterCalculator(): JitterCalculator {
    return this.jitterCalculator;
  }

  getQualityScorer(): ConnectionQualityScorer {
    return this.qualityScorer;
  }

  getStore(): PeerMetricsStore {
    return this.store;
  }

  getAggregator(): RoomMetricsAggregator {
    return this.aggregator;
  }

  getSnapshotBuilder(): SnapshotBuilder {
    return this.snapshotBuilder;
  }
}
