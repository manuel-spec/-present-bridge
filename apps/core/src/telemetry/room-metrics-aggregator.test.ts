import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import { PeerMetricsStore } from "./peer-metrics-store.js";
import { RoomMetricsAggregator, summarizeRoomHealth } from "./room-metrics-aggregator.js";
import { DEFAULT_TELEMETRY_CONFIG } from "./types.js";

describe("RoomMetricsAggregator", () => {
  let store: PeerMetricsStore;
  let aggregator: RoomMetricsAggregator;

  beforeEach(() => {
    store = new PeerMetricsStore({ rollingWindow: DEFAULT_TELEMETRY_CONFIG.rollingWindow });
    aggregator = new RoomMetricsAggregator({ config: DEFAULT_TELEMETRY_CONFIG, store });
  });

  function seedPeer(
    peerId: string,
    roomId: string,
    opts: { latency?: number; upload?: number; download?: number; loss?: number } = {},
  ): void {
    store.create({ peerId, roomId, displayName: peerId });
    if (opts.latency !== undefined) {
      store.recordLatency({ peerId, rttMs: opts.latency });
    }
    if (opts.upload !== undefined) {
      store.recordBandwidth({
        peerId,
        direction: "upload",
        bytesTransferred: opts.upload,
        intervalMs: 1000,
      });
    }
    if (opts.download !== undefined) {
      store.recordBandwidth({
        peerId,
        direction: "download",
        bytesTransferred: opts.download,
        intervalMs: 1000,
      });
    }
    if (opts.loss !== undefined) {
      const sent = 100;
      const lost = Math.round(sent * opts.loss);
      store.recordPacketLoss({
        peerId,
        packetsSent: sent,
        packetsReceived: sent - lost,
        packetsLost: lost,
      });
    }
  }

  it("aggregates peer metrics for a room", () => {
    seedPeer("peer-1", "room-a", { latency: 50, upload: 10_000, download: 20_000, loss: 0.01 });
    const result = aggregator.aggregateRoom("room-a");

    expect(result.peers).toHaveLength(1);
    expect(result.metrics.roomId).toBe("room-a");
    expect(result.metrics.peerCount).toBe(1);
    expect(result.metrics.averageLatencyMs).toBeGreaterThan(0);
    expect(result.peers[0].quality.score).toBeGreaterThan(0);
  });

  it("aggregates multiple peers with quality distribution", () => {
    seedPeer("peer-1", "room-a", { latency: 30, download: 50_000, loss: 0.001 });
    seedPeer("peer-2", "room-a", { latency: 200, download: 5000, loss: 0.08 });

    const result = aggregator.aggregateRoom("room-a");
    const grades = Object.values(result.metrics.qualityDistribution);
    expect(result.metrics.peerCount).toBe(2);
    expect(grades.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(result.metrics.worstQualityScore).toBeLessThanOrEqual(result.metrics.averageQualityScore);
  });

  it("aggregates all rooms", () => {
    seedPeer("peer-1", "room-a", { latency: 50 });
    seedPeer("peer-2", "room-b", { latency: 60 });

    const result = aggregator.aggregateAllRooms();
    expect(result.rooms).toHaveLength(2);
    expect(result.allPeers).toHaveLength(2);
  });

  it("throws when room has no telemetry data", () => {
    expect(() => aggregator.requireRoomMetrics("missing")).toThrow(AppError);
    try {
      aggregator.requireRoomMetrics("missing");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ROOM_NOT_FOUND);
    }
  });

  it("lists room ids from store", () => {
    seedPeer("peer-1", "room-a", { latency: 50 });
    seedPeer("peer-2", "room-b", { latency: 60 });
    expect(aggregator.listRoomIds().sort()).toEqual(["room-a", "room-b"]);
  });

  it("ranks top and worst peers by quality", () => {
    seedPeer("peer-good", "room-a", { latency: 30, download: 50_000, loss: 0.001 });
    seedPeer("peer-bad", "room-a", { latency: 300, download: 5000, loss: 0.1 });

    const top = aggregator.topPeersByQuality("room-a", 1);
    const worst = aggregator.worstPeersByQuality("room-a", 1);

    expect(top[0].peerId).toBe("peer-good");
    expect(worst[0].peerId).toBe("peer-bad");
  });

  it("finds peers below quality threshold", () => {
    seedPeer("peer-good", "room-a", { latency: 30, download: 50_000, loss: 0.001 });
    seedPeer("peer-bad", "room-a", { latency: 300, download: 5000, loss: 0.1 });

    const below = aggregator.peersBelowQualityThreshold("room-a", 55);
    expect(below.some((peer) => peer.peerId === "peer-bad")).toBe(true);
  });

  it("computes room bandwidth totals", () => {
    seedPeer("peer-1", "room-a", { upload: 10_000, download: 20_000 });
    seedPeer("peer-2", "room-a", { upload: 15_000, download: 25_000 });

    const totals = aggregator.roomBandwidthTotals("room-a");
    expect(totals.uploadBps).toBeGreaterThan(0);
    expect(totals.downloadBps).toBeGreaterThan(totals.uploadBps);
  });

  it("marks stale peers", () => {
    const now = Date.now();
    store.create({ peerId: "peer-1", roomId: "room-a", connectedAt: now - 120_000 });
    store.recordLatency({ peerId: "peer-1", rttMs: 50, timestamp: now - 120_000 });

    const peer = aggregator.aggregatePeer("peer-1", now);
    expect(peer.isStale).toBe(true);
  });

  it("summarizes room health from average score", () => {
    seedPeer("peer-1", "room-a", { latency: 30, download: 50_000, loss: 0.001 });
    const metrics = aggregator.aggregateRoom("room-a").metrics;
    expect(summarizeRoomHealth(metrics)).toBe(
      metrics.averageQualityScore >= 90
        ? "excellent"
        : metrics.averageQualityScore >= 75
          ? "good"
          : "fair",
    );
  });
});
