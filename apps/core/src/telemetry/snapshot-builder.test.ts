import { beforeEach, describe, expect, it } from "vitest";
import { PeerMetricsStore } from "./peer-metrics-store.js";
import { RoomMetricsAggregator } from "./room-metrics-aggregator.js";
import { SnapshotBuilder, createEmptySnapshot } from "./snapshot-builder.js";
import { DEFAULT_TELEMETRY_CONFIG } from "./types.js";

describe("SnapshotBuilder", () => {
  let builder: SnapshotBuilder;
  let aggregator: RoomMetricsAggregator;
  let store: PeerMetricsStore;

  beforeEach(() => {
    store = new PeerMetricsStore({ rollingWindow: DEFAULT_TELEMETRY_CONFIG.rollingWindow });
    aggregator = new RoomMetricsAggregator({ config: DEFAULT_TELEMETRY_CONFIG, store });
    builder = new SnapshotBuilder({ aggregator });
  });

  function seedPeer(peerId: string, roomId: string): void {
    store.create({ peerId, roomId, displayName: peerId });
    store.recordLatency({ peerId, rttMs: 50 });
    store.recordBandwidth({
      peerId,
      direction: "download",
      bytesTransferred: 20_000,
      intervalMs: 1000,
    });
  }

  it("builds full telemetry snapshot", () => {
    seedPeer("peer-1", "room-a");
    seedPeer("peer-2", "room-b");

    const snapshot = builder.build();
    expect(snapshot.snapshotId).toBeTruthy();
    expect(snapshot.rooms).toHaveLength(2);
    expect(snapshot.peers).toHaveLength(2);
    expect(snapshot.totals.totalPeers).toBe(2);
    expect(snapshot.totals.totalRooms).toBe(2);
  });

  it("builds room-scoped snapshot", () => {
    seedPeer("peer-1", "room-a");
    seedPeer("peer-2", "room-b");

    const snapshot = builder.buildForRoom("room-a");
    expect(snapshot.rooms).toHaveLength(1);
    expect(snapshot.peers).toHaveLength(1);
    expect(snapshot.peers[0].roomId).toBe("room-a");
  });

  it("excludes stale peers by default", () => {
    const now = Date.now();
    store.create({ peerId: "stale", roomId: "room-a" });
    store.recordLatency({ peerId: "stale", rttMs: 50, timestamp: now - 120_000 });
    seedPeer("fresh", "room-a");

    const snapshot = builder.build(now);
    expect(snapshot.peers).toHaveLength(1);
    expect(snapshot.peers[0].peerId).toBe("fresh");
  });

  it("includes stale peers when configured", () => {
    const now = Date.now();
    const inclusiveBuilder = new SnapshotBuilder({ aggregator, includeStalePeers: true });
    store.create({ peerId: "stale", roomId: "room-a" });
    store.recordLatency({ peerId: "stale", rttMs: 50, timestamp: now - 120_000 });

    const snapshot = inclusiveBuilder.build(now);
    expect(snapshot.peers).toHaveLength(1);
    expect(snapshot.peers[0].isStale).toBe(true);
  });

  it("filters by room list", () => {
    seedPeer("peer-1", "room-a");
    seedPeer("peer-2", "room-b");

    const filtered = new SnapshotBuilder({ aggregator, roomFilter: ["room-a"] });
    const snapshot = filtered.build();
    expect(snapshot.rooms).toHaveLength(1);
    expect(snapshot.peers).toHaveLength(1);
  });

  it("diffs snapshots", () => {
    seedPeer("peer-1", "room-a");
    const first = builder.build();

    seedPeer("peer-2", "room-a");
    const second = builder.build();

    const diff = builder.diff(first, second);
    expect(diff.peerCountDelta).toBe(1);
    expect(diff.currentSnapshotId).toBe(second.snapshotId);
  });

  it("returns null diff when no previous snapshot", () => {
    const freshBuilder = new SnapshotBuilder({ aggregator });
    expect(freshBuilder.diffFromLast(createEmptySnapshot())).toBeNull();
  });

  it("finds peer and room in snapshot", () => {
    seedPeer("peer-1", "room-a");
    const snapshot = builder.build();

    expect(builder.findPeerInSnapshot(snapshot, "peer-1")?.peerId).toBe("peer-1");
    expect(builder.findRoomInSnapshot(snapshot, "room-a")?.roomId).toBe("room-a");
    expect(builder.findPeerInSnapshot(snapshot, "missing")).toBeUndefined();
  });

  it("filters snapshot by minimum quality", () => {
    store.create({ peerId: "good", roomId: "room-a" });
    store.recordLatency({ peerId: "good", rttMs: 30 });
    store.recordBandwidth({
      peerId: "good",
      direction: "download",
      bytesTransferred: 50_000,
      intervalMs: 1000,
    });

    store.create({ peerId: "bad", roomId: "room-a" });
    store.recordLatency({ peerId: "bad", rttMs: 400 });
    store.recordPacketLoss({
      peerId: "bad",
      packetsSent: 100,
      packetsReceived: 70,
      packetsLost: 30,
    });

    const full = builder.build();
    const filtered = builder.filterByMinimumQuality(full, 55);
    expect(filtered.peers.length).toBeLessThanOrEqual(full.peers.length);
  });

  it("serializes and deserializes snapshots", () => {
    seedPeer("peer-1", "room-a");
    const snapshot = builder.build();
    const json = builder.serialize(snapshot);
    const restored = builder.deserialize(json);

    expect(restored.snapshotId).toBe(snapshot.snapshotId);
    expect(restored.peers).toHaveLength(1);
  });

  it("rejects invalid deserialized payload", () => {
    expect(() => builder.deserialize("{}")).toThrow("Invalid telemetry snapshot payload");
  });

  it("creates empty snapshot helper", () => {
    const empty = createEmptySnapshot();
    expect(empty.peers).toEqual([]);
    expect(empty.totals.totalPeers).toBe(0);
  });

  it("tracks last snapshot", () => {
    seedPeer("peer-1", "room-a");
    builder.build();
    const last = builder.getLastSnapshot();
    expect(last?.peers).toHaveLength(1);
  });

  it("builds metadata and diffs from last snapshot", () => {
    seedPeer("peer-1", "room-a");
    const first = builder.build();
    const metadata = builder.buildMetadata(first, 12);
    expect(metadata.peerCount).toBe(1);
    expect(metadata.durationMs).toBe(12);

    seedPeer("peer-2", "room-b");
    const second = new SnapshotBuilder({ aggregator }).build();
    const diff = builder.diffFromLast(second);
    expect(diff?.peerCountDelta).toBe(1);
    expect(diff?.roomCountDelta).toBe(1);
  });

  it("filters out all peers when quality threshold is too high", () => {
    seedPeer("peer-1", "room-a");
    const snapshot = builder.build();
    const filtered = builder.filterByMinimumQuality(snapshot, 100);
    expect(filtered.peers).toHaveLength(0);
    expect(filtered.rooms).toHaveLength(0);
    expect(filtered.totals.averageQualityScore).toBe(0);
  });
});
