import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import type {
  BandwidthSample,
  CreatePeerMetricsInput,
  LatencySample,
  PacketLossSample,
  PeerMetricsRecord,
  RecordBandwidthInput,
  RecordLatencyInput,
  RecordPacketLossInput,
  RollingWindowConfig,
  UpdatePeerInput,
} from "./types.js";
import {
  createEmptyPeerMetricsRecord,
  isValidBandwidthSample,
  isValidLatencySample,
  isValidPacketLossSample,
} from "./types.js";

export interface PeerMetricsStoreOptions {
  rollingWindow: RollingWindowConfig;
}

export interface PeerMetricsQuery {
  roomId?: string;
  includeStale?: boolean;
  staleThresholdMs?: number;
}

export interface PeerMetricsStoreStats {
  totalPeers: number;
  totalRooms: number;
  totalLatencySamples: number;
  totalBandwidthSamples: number;
  totalPacketLossSamples: number;
}

function pruneSamples<T extends { timestamp: number }>(
  samples: T[],
  now: number,
  config: RollingWindowConfig,
): T[] {
  const cutoffRetention = now - config.retentionMs;
  const cutoffWindow = now - config.windowMs;

  let pruned = samples.filter((sample) => sample.timestamp >= cutoffRetention);

  if (pruned.length > config.maxSamples) {
    pruned = pruned.slice(pruned.length - config.maxSamples);
  }

  return pruned.filter((sample) => sample.timestamp >= cutoffWindow || pruned.length <= config.maxSamples);
}

function retainAllSamples<T extends { timestamp: number }>(
  samples: T[],
  now: number,
  config: RollingWindowConfig,
): T[] {
  const cutoffRetention = now - config.retentionMs;
  let retained = samples.filter((sample) => sample.timestamp >= cutoffRetention);

  if (retained.length > config.maxSamples) {
    retained = retained.slice(retained.length - config.maxSamples);
  }

  return retained;
}

export class PeerMetricsStore {
  private readonly peers = new Map<string, PeerMetricsRecord>();
  private readonly roomIndex = new Map<string, Set<string>>();
  private readonly config: RollingWindowConfig;

  constructor(options: PeerMetricsStoreOptions) {
    this.config = options.rollingWindow;
  }

  create(input: CreatePeerMetricsInput): PeerMetricsRecord {
    if (this.peers.has(input.peerId)) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, `Peer metrics already exist: ${input.peerId}`);
    }

    const record = createEmptyPeerMetricsRecord(input);
    this.peers.set(input.peerId, record);
    this.indexPeer(input.peerId, input.roomId);
    return this.cloneRecord(record);
  }

  get(peerId: string): PeerMetricsRecord {
    const record = this.peers.get(peerId);
    if (!record) {
      throw new AppError(ErrorCode.PEER_NOT_FOUND, `Peer metrics not found: ${peerId}`);
    }
    return this.cloneRecord(record);
  }

  getOrCreate(input: CreatePeerMetricsInput): PeerMetricsRecord {
    const existing = this.peers.get(input.peerId);
    if (existing) {
      return this.cloneRecord(existing);
    }
    return this.create(input);
  }

  has(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  update(peerId: string, input: UpdatePeerInput): PeerMetricsRecord {
    const record = this.requireRecord(peerId);

    if (input.displayName !== undefined) {
      record.displayName = input.displayName;
    }

    if (input.roomId !== undefined && input.roomId !== record.roomId) {
      this.unindexPeer(peerId, record.roomId);
      record.roomId = input.roomId;
      this.indexPeer(peerId, input.roomId);
    }

    record.lastUpdatedAt = Date.now();
    return this.cloneRecord(record);
  }

  delete(peerId: string): boolean {
    const record = this.peers.get(peerId);
    if (!record) {
      return false;
    }

    this.unindexPeer(peerId, record.roomId);
    this.peers.delete(peerId);
    return true;
  }

  deleteByRoom(roomId: string): number {
    const peerIds = this.roomIndex.get(roomId);
    if (!peerIds) {
      return 0;
    }

    let removed = 0;
    for (const peerId of [...peerIds]) {
      if (this.delete(peerId)) {
        removed += 1;
      }
    }
    return removed;
  }

  list(query: PeerMetricsQuery = {}): PeerMetricsRecord[] {
    const now = Date.now();
    const staleThreshold = query.staleThresholdMs ?? this.config.retentionMs;

    let records = [...this.peers.values()];

    if (query.roomId) {
      const peerIds = this.roomIndex.get(query.roomId);
      if (!peerIds || peerIds.size === 0) {
        return [];
      }
      records = records.filter((record) => peerIds.has(record.peerId));
    }

    if (!query.includeStale) {
      records = records.filter((record) => now - record.lastUpdatedAt <= staleThreshold);
    }

    return records.map((record) => this.cloneRecord(record));
  }

  listPeerIdsByRoom(roomId: string): string[] {
    const peerIds = this.roomIndex.get(roomId);
    return peerIds ? [...peerIds] : [];
  }

  recordLatency(input: RecordLatencyInput): LatencySample {
    const record = this.requireRecord(input.peerId);
    const timestamp = input.timestamp ?? Date.now();

    const sample: LatencySample = {
      timestamp,
      rttMs: input.rttMs,
      oneWayMs: input.oneWayMs,
      transportKind: input.transportKind,
    };

    if (!isValidLatencySample(sample)) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, `Invalid latency sample for peer: ${input.peerId}`);
    }

    record.latencySamples.push(sample);
    record.latencySamples = retainAllSamples(record.latencySamples, timestamp, this.config);
    record.lastUpdatedAt = timestamp;

    return { ...sample };
  }

  recordBandwidth(input: RecordBandwidthInput): BandwidthSample {
    const record = this.requireRecord(input.peerId);
    const timestamp = input.timestamp ?? Date.now();

    const sample: BandwidthSample = {
      timestamp,
      direction: input.direction,
      bytesTransferred: input.bytesTransferred,
      intervalMs: input.intervalMs,
      transportKind: input.transportKind,
    };

    if (!isValidBandwidthSample(sample)) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, `Invalid bandwidth sample for peer: ${input.peerId}`);
    }

    record.bandwidthSamples.push(sample);
    record.bandwidthSamples = retainAllSamples(record.bandwidthSamples, timestamp, this.config);
    record.lastUpdatedAt = timestamp;

    return { ...sample };
  }

  recordPacketLoss(input: RecordPacketLossInput): PacketLossSample {
    const record = this.requireRecord(input.peerId);
    const timestamp = input.timestamp ?? Date.now();
    const packetsLost = input.packetsLost ?? Math.max(0, input.packetsSent - input.packetsReceived);

    const sample: PacketLossSample = {
      timestamp,
      packetsSent: input.packetsSent,
      packetsReceived: input.packetsReceived,
      packetsLost,
      transportKind: input.transportKind,
    };

    if (!isValidPacketLossSample(sample)) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, `Invalid packet loss sample for peer: ${input.peerId}`);
    }

    record.packetLossSamples.push(sample);
    record.packetLossSamples = retainAllSamples(record.packetLossSamples, timestamp, this.config);
    record.lastUpdatedAt = timestamp;

    return { ...sample };
  }

  getLatencySamples(peerId: string, windowMs?: number): LatencySample[] {
    const record = this.requireRecord(peerId);
    return this.filterByWindow(record.latencySamples, windowMs);
  }

  getBandwidthSamples(peerId: string, windowMs?: number): BandwidthSample[] {
    const record = this.requireRecord(peerId);
    return this.filterByWindow(record.bandwidthSamples, windowMs);
  }

  getPacketLossSamples(peerId: string, windowMs?: number): PacketLossSample[] {
    const record = this.requireRecord(peerId);
    return this.filterByWindow(record.packetLossSamples, windowMs);
  }

  prune(peerId?: string, now: number = Date.now()): number {
    if (peerId) {
      const record = this.peers.get(peerId);
      if (!record) {
        return 0;
      }
      return this.pruneRecord(record, now);
    }

    let prunedTotal = 0;
    for (const record of this.peers.values()) {
      prunedTotal += this.pruneRecord(record, now);
    }
    return prunedTotal;
  }

  clear(): void {
    this.peers.clear();
    this.roomIndex.clear();
  }

  stats(): PeerMetricsStoreStats {
    let totalLatencySamples = 0;
    let totalBandwidthSamples = 0;
    let totalPacketLossSamples = 0;

    for (const record of this.peers.values()) {
      totalLatencySamples += record.latencySamples.length;
      totalBandwidthSamples += record.bandwidthSamples.length;
      totalPacketLossSamples += record.packetLossSamples.length;
    }

    return {
      totalPeers: this.peers.size,
      totalRooms: this.roomIndex.size,
      totalLatencySamples,
      totalBandwidthSamples,
      totalPacketLossSamples,
    };
  }

  count(): number {
    return this.peers.size;
  }

  countByRoom(roomId: string): number {
    return this.roomIndex.get(roomId)?.size ?? 0;
  }

  private requireRecord(peerId: string): PeerMetricsRecord {
    const record = this.peers.get(peerId);
    if (!record) {
      throw new AppError(ErrorCode.PEER_NOT_FOUND, `Peer metrics not found: ${peerId}`);
    }
    return record;
  }

  private indexPeer(peerId: string, roomId: string): void {
    let peerIds = this.roomIndex.get(roomId);
    if (!peerIds) {
      peerIds = new Set();
      this.roomIndex.set(roomId, peerIds);
    }
    peerIds.add(peerId);
  }

  private unindexPeer(peerId: string, roomId: string): void {
    const peerIds = this.roomIndex.get(roomId);
    if (!peerIds) {
      return;
    }
    peerIds.delete(peerId);
    if (peerIds.size === 0) {
      this.roomIndex.delete(roomId);
    }
  }

  private filterByWindow<T extends { timestamp: number }>(samples: T[], windowMs?: number): T[] {
    const effectiveWindow = windowMs ?? this.config.windowMs;
    const cutoff = Date.now() - effectiveWindow;
    return samples
      .filter((sample) => sample.timestamp >= cutoff)
      .map((sample) => ({ ...sample }));
  }

  private pruneRecord(record: PeerMetricsRecord, now: number): number {
    const before =
      record.latencySamples.length + record.bandwidthSamples.length + record.packetLossSamples.length;

    record.latencySamples = pruneSamples(record.latencySamples, now, this.config);
    record.bandwidthSamples = pruneSamples(record.bandwidthSamples, now, this.config);
    record.packetLossSamples = pruneSamples(record.packetLossSamples, now, this.config);

    const after =
      record.latencySamples.length + record.bandwidthSamples.length + record.packetLossSamples.length;

    return before - after;
  }

  private cloneRecord(record: PeerMetricsRecord): PeerMetricsRecord {
    return {
      peerId: record.peerId,
      roomId: record.roomId,
      displayName: record.displayName,
      connectedAt: record.connectedAt,
      lastUpdatedAt: record.lastUpdatedAt,
      latencySamples: record.latencySamples.map((sample) => ({ ...sample })),
      bandwidthSamples: record.bandwidthSamples.map((sample) => ({ ...sample })),
      packetLossSamples: record.packetLossSamples.map((sample) => ({ ...sample })),
    };
  }
}
