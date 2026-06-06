import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCode } from "@bridge-packet/shared";
import { AppError } from "../lib/errors.js";
import { PeerMetricsStore } from "./peer-metrics-store.js";
import { DEFAULT_TELEMETRY_CONFIG } from "./types.js";

describe("PeerMetricsStore", () => {
  let store: PeerMetricsStore;

  beforeEach(() => {
    store = new PeerMetricsStore({ rollingWindow: DEFAULT_TELEMETRY_CONFIG.rollingWindow });
  });

  it("creates and retrieves peer metrics", () => {
    const created = store.create({ peerId: "peer-1", roomId: "room-1", displayName: "Alice" });
    const fetched = store.get("peer-1");

    expect(created.peerId).toBe("peer-1");
    expect(fetched.roomId).toBe("room-1");
    expect(fetched.displayName).toBe("Alice");
  });

  it("throws when creating duplicate peer", () => {
    store.create({ peerId: "peer-1", roomId: "room-1" });
    expect(() => store.create({ peerId: "peer-1", roomId: "room-1" })).toThrow(AppError);
    try {
      store.create({ peerId: "peer-1", roomId: "room-1" });
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.INTERNAL_ERROR);
    }
  });

  it("throws when fetching missing peer", () => {
    expect(() => store.get("missing")).toThrow(AppError);
    try {
      store.get("missing");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.PEER_NOT_FOUND);
    }
  });

  it("getOrCreate returns existing record", () => {
    store.create({ peerId: "peer-1", roomId: "room-1" });
    const record = store.getOrCreate({ peerId: "peer-1", roomId: "room-2" });
    expect(record.roomId).toBe("room-1");
  });

  it("updates peer display name and room", () => {
    store.create({ peerId: "peer-1", roomId: "room-a" });
    const updated = store.update("peer-1", { displayName: "Bob", roomId: "room-b" });

    expect(updated.displayName).toBe("Bob");
    expect(updated.roomId).toBe("room-b");
    expect(store.listPeerIdsByRoom("room-b")).toContain("peer-1");
    expect(store.listPeerIdsByRoom("room-a")).toHaveLength(0);
  });

  it("deletes peer and room index entries", () => {
    store.create({ peerId: "peer-1", roomId: "room-1" });
    expect(store.delete("peer-1")).toBe(true);
    expect(store.has("peer-1")).toBe(false);
    expect(store.delete("peer-1")).toBe(false);
  });

  it("deletes all peers in a room", () => {
    store.create({ peerId: "peer-1", roomId: "room-1" });
    store.create({ peerId: "peer-2", roomId: "room-1" });
    store.create({ peerId: "peer-3", roomId: "room-2" });

    expect(store.deleteByRoom("room-1")).toBe(2);
    expect(store.count()).toBe(1);
    expect(store.countByRoom("room-1")).toBe(0);
  });

  it("records latency samples", () => {
    store.create({ peerId: "peer-1", roomId: "room-1" });
    const sample = store.recordLatency({ peerId: "peer-1", rttMs: 45 });

    expect(sample.rttMs).toBe(45);
    expect(store.getLatencySamples("peer-1")).toHaveLength(1);
  });

  it("rejects invalid latency samples", () => {
    store.create({ peerId: "peer-1", roomId: "room-1" });
    expect(() => store.recordLatency({ peerId: "peer-1", rttMs: -5 })).toThrow(AppError);
  });

  it("records bandwidth samples", () => {
    store.create({ peerId: "peer-1", roomId: "room-1" });
    store.recordBandwidth({
      peerId: "peer-1",
      direction: "upload",
      bytesTransferred: 50_000,
      intervalMs: 1000,
    });

    expect(store.getBandwidthSamples("peer-1")).toHaveLength(1);
  });

  it("records packet loss samples", () => {
    store.create({ peerId: "peer-1", roomId: "room-1" });
    store.recordPacketLoss({
      peerId: "peer-1",
      packetsSent: 100,
      packetsReceived: 97,
    });

    const samples = store.getPacketLossSamples("peer-1");
    expect(samples[0].packetsLost).toBe(3);
  });

  it("lists peers by room", () => {
    store.create({ peerId: "peer-1", roomId: "room-a" });
    store.create({ peerId: "peer-2", roomId: "room-a" });
    store.create({ peerId: "peer-3", roomId: "room-b" });

    expect(store.list({ roomId: "room-a" })).toHaveLength(2);
    expect(store.list({ roomId: "room-b" })).toHaveLength(1);
    expect(store.list({ roomId: "missing" })).toHaveLength(0);
  });

  it("filters stale peers from list by default", () => {
    const now = Date.now();
    store.create({ peerId: "peer-1", roomId: "room-1", connectedAt: now - 500_000 });
    store.recordLatency({ peerId: "peer-1", rttMs: 50, timestamp: now - 500_000 });

    expect(store.list()).toHaveLength(0);
    expect(store.list({ includeStale: true })).toHaveLength(1);
  });

  it("prunes old samples", () => {
    const now = Date.now();
    store.create({ peerId: "peer-1", roomId: "room-1" });

    store.recordLatency({ peerId: "peer-1", rttMs: 50, timestamp: now - 400_000 });
    store.recordLatency({ peerId: "peer-1", rttMs: 60, timestamp: now });

    const pruned = store.prune("peer-1", now);
    expect(pruned).toBeGreaterThanOrEqual(0);
    expect(store.getLatencySamples("peer-1", 30_000)).toHaveLength(1);
  });

  it("reports store stats", () => {
    store.create({ peerId: "peer-1", roomId: "room-1" });
    store.recordLatency({ peerId: "peer-1", rttMs: 50 });
    store.recordBandwidth({
      peerId: "peer-1",
      direction: "download",
      bytesTransferred: 1000,
      intervalMs: 1000,
    });

    const stats = store.stats();
    expect(stats.totalPeers).toBe(1);
    expect(stats.totalRooms).toBe(1);
    expect(stats.totalLatencySamples).toBe(1);
    expect(stats.totalBandwidthSamples).toBe(1);
  });

  it("throws when recording metrics for missing peers", () => {
    expect(() => store.recordLatency({ peerId: "missing", rttMs: 10 })).toThrow(AppError);
    expect(() =>
      store.recordBandwidth({
        peerId: "missing",
        direction: "upload",
        bytesTransferred: 1,
        intervalMs: 1,
      }),
    ).toThrow(AppError);
  });

  it("removes empty room index entries on delete", () => {
    store.create({ peerId: "solo", roomId: "solo-room" });
    store.delete("solo");
    expect(store.countByRoom("solo-room")).toBe(0);
  });

  it("returns zero when pruning unknown peer", () => {
    expect(store.prune("missing")).toBe(0);
  });

  it("clears all data", () => {
    store.create({ peerId: "peer-1", roomId: "room-1" });
    store.clear();
    expect(store.count()).toBe(0);
    expect(store.stats().totalRooms).toBe(0);
  });
});
