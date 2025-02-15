import { randomUUID } from "node:crypto";
import type { RoomMetricsAggregator } from "./room-metrics-aggregator.js";
import type { PeerMetrics, RoomMetrics, TelemetrySnapshot, TelemetryTotals } from "./types.js";

export interface SnapshotBuilderOptions {
  aggregator: RoomMetricsAggregator;
  includeStalePeers?: boolean;
  roomFilter?: string[];
}

export interface SnapshotMetadata {
  snapshotId: string;
  generatedAt: number;
  peerCount: number;
  roomCount: number;
  durationMs: number;
}

export interface SnapshotDiff {
  previousSnapshotId: string;
  currentSnapshotId: string;
  peerCountDelta: number;
  roomCountDelta: number;
  qualityScoreDelta: number;
  uploadBpsDelta: number;
  downloadBpsDelta: number;
}

export class SnapshotBuilder {
  private readonly aggregator: RoomMetricsAggregator;
  private readonly includeStalePeers: boolean;
  private readonly roomFilter: Set<string> | null;
  private lastSnapshot: TelemetrySnapshot | null = null;

  constructor(options: SnapshotBuilderOptions) {
    this.aggregator = options.aggregator;
    this.includeStalePeers = options.includeStalePeers ?? false;
    this.roomFilter = options.roomFilter ? new Set(options.roomFilter) : null;
  }

  build(now: number = Date.now()): TelemetrySnapshot {
    const start = Date.now();
    const aggregation = this.aggregator.aggregateAllRooms(now);

    let rooms = aggregation.rooms;
    let peers = aggregation.allPeers;

    if (this.roomFilter) {
      rooms = rooms.filter((room) => this.roomFilter!.has(room.roomId));
      peers = peers.filter((peer) => this.roomFilter!.has(peer.roomId));
    }

    if (!this.includeStalePeers) {
      peers = peers.filter((peer) => !peer.isStale);
      const activePeerCounts = new Map<string, number>();
      for (const peer of peers) {
        activePeerCounts.set(peer.roomId, (activePeerCounts.get(peer.roomId) ?? 0) + 1);
      }
      rooms = rooms.map((room) => ({
        ...room,
        activePeerCount: activePeerCounts.get(room.roomId) ?? 0,
        peerCount: activePeerCounts.get(room.roomId) ?? 0,
      }));
    }

    const totals = this.computeTotals(rooms, peers);

    const snapshot: TelemetrySnapshot = {
      generatedAt: now,
      snapshotId: randomUUID(),
      rooms,
      peers,
      totals,
    };

    this.lastSnapshot = snapshot;
    void start;

    return snapshot;
  }

  buildForRoom(roomId: string, now: number = Date.now()): TelemetrySnapshot {
    const result = this.aggregator.aggregateRoom(roomId, now);
    let peers = result.peers;

    if (!this.includeStalePeers) {
      peers = peers.filter((peer) => !peer.isStale);
    }

    const rooms = [result.metrics];
    const totals = this.computeTotals(rooms, peers);

    const snapshot: TelemetrySnapshot = {
      generatedAt: now,
      snapshotId: randomUUID(),
      rooms,
      peers,
      totals,
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  buildMetadata(snapshot: TelemetrySnapshot, durationMs: number): SnapshotMetadata {
    return {
      snapshotId: snapshot.snapshotId,
      generatedAt: snapshot.generatedAt,
      peerCount: snapshot.peers.length,
      roomCount: snapshot.rooms.length,
      durationMs,
    };
  }

  diffFromLast(current: TelemetrySnapshot): SnapshotDiff | null {
    if (!this.lastSnapshot) {
      return null;
    }
    return this.diff(this.lastSnapshot, current);
  }

  diff(previous: TelemetrySnapshot, current: TelemetrySnapshot): SnapshotDiff {
    return {
      previousSnapshotId: previous.snapshotId,
      currentSnapshotId: current.snapshotId,
      peerCountDelta: current.totals.totalPeers - previous.totals.totalPeers,
      roomCountDelta: current.totals.totalRooms - previous.totals.totalRooms,
      qualityScoreDelta:
        current.totals.averageQualityScore - previous.totals.averageQualityScore,
      uploadBpsDelta: current.totals.totalUploadBps - previous.totals.totalUploadBps,
      downloadBpsDelta: current.totals.totalDownloadBps - previous.totals.totalDownloadBps,
    };
  }

  getLastSnapshot(): TelemetrySnapshot | null {
    return this.lastSnapshot ? this.cloneSnapshot(this.lastSnapshot) : null;
  }

  findPeerInSnapshot(snapshot: TelemetrySnapshot, peerId: string): PeerMetrics | undefined {
    return snapshot.peers.find((peer) => peer.peerId === peerId);
  }

  findRoomInSnapshot(snapshot: TelemetrySnapshot, roomId: string): RoomMetrics | undefined {
    return snapshot.rooms.find((room) => room.roomId === roomId);
  }

  filterByMinimumQuality(snapshot: TelemetrySnapshot, minimumScore: number): TelemetrySnapshot {
    const peers = snapshot.peers.filter((peer) => peer.quality.score >= minimumScore);
    const peerIdsByRoom = new Map<string, Set<string>>();

    for (const peer of peers) {
      let ids = peerIdsByRoom.get(peer.roomId);
      if (!ids) {
        ids = new Set();
        peerIdsByRoom.set(peer.roomId, ids);
      }
      ids.add(peer.peerId);
    }

    const rooms = snapshot.rooms
      .filter((room) => peerIdsByRoom.has(room.roomId))
      .map((room) => {
        const roomPeers = peers.filter((peer) => peer.roomId === room.roomId);
        const qualities = roomPeers.map((peer) => peer.quality.score);
        return {
          ...room,
          peerCount: roomPeers.length,
          activePeerCount: roomPeers.filter((peer) => !peer.isStale).length,
          averageQualityScore:
            qualities.length > 0
              ? Math.round(qualities.reduce((sum, score) => sum + score, 0) / qualities.length)
              : 0,
        };
      });

    return {
      ...snapshot,
      snapshotId: randomUUID(),
      generatedAt: Date.now(),
      rooms,
      peers,
      totals: this.computeTotals(rooms, peers),
    };
  }

  serialize(snapshot: TelemetrySnapshot): string {
    return JSON.stringify(snapshot);
  }

  deserialize(json: string): TelemetrySnapshot {
    const parsed = JSON.parse(json) as TelemetrySnapshot;
    if (!parsed.snapshotId || !parsed.generatedAt || !Array.isArray(parsed.peers)) {
      throw new Error("Invalid telemetry snapshot payload");
    }
    return parsed;
  }

  private computeTotals(rooms: RoomMetrics[], peers: PeerMetrics[]): TelemetryTotals {
    const qualityScores = peers.map((peer) => peer.quality.score);

    return {
      totalPeers: peers.length,
      totalRooms: rooms.length,
      averageQualityScore:
        qualityScores.length > 0
          ? Math.round(qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length)
          : 0,
      totalUploadBps: peers.reduce((sum, peer) => sum + peer.upload.bitsPerSecond, 0),
      totalDownloadBps: peers.reduce((sum, peer) => sum + peer.download.bitsPerSecond, 0),
    };
  }

  private cloneSnapshot(snapshot: TelemetrySnapshot): TelemetrySnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as TelemetrySnapshot;
  }
}

export function createEmptySnapshot(now: number = Date.now()): TelemetrySnapshot {
  return {
    generatedAt: now,
    snapshotId: randomUUID(),
    rooms: [],
    peers: [],
    totals: {
      totalPeers: 0,
      totalRooms: 0,
      averageQualityScore: 0,
      totalUploadBps: 0,
      totalDownloadBps: 0,
    },
  };
}
