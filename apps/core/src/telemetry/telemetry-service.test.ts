import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import { TelemetryService } from "./telemetry-service.js";

describe("TelemetryService", () => {
  let service: TelemetryService;

  beforeEach(() => {
    service = new TelemetryService();
  });

  it("registers peer and returns metrics", () => {
    const metrics = service.registerPeer({
      peerId: "peer-1",
      roomId: "room-a",
      displayName: "Alice",
      initialLatencyMs: 45,
    });

    expect(metrics.peerId).toBe("peer-1");
    expect(metrics.roomId).toBe("room-a");
    expect(metrics.latency.meanLatencyMs).toBe(45);
    expect(service.hasPeer("peer-1")).toBe(true);
    expect(service.hasRoom("room-a")).toBe(true);
  });

  it("throws when fetching unknown peer", () => {
    expect(() => service.getPeerMetrics("missing")).toThrow(AppError);
    try {
      service.getPeerMetrics("missing");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.PEER_NOT_FOUND);
    }
  });

  it("throws when fetching unknown room", () => {
    expect(() => service.getRoomMetrics("missing")).toThrow(AppError);
    try {
      service.getRoomMetrics("missing");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ROOM_NOT_FOUND);
    }
  });

  it("records latency, bandwidth, and packet loss", () => {
    service.registerPeer({ peerId: "peer-1", roomId: "room-a" });

    service.recordLatency({ peerId: "peer-1", rttMs: 50 });
    service.recordBandwidth({
      peerId: "peer-1",
      direction: "download",
      bytesTransferred: 25_000,
      intervalMs: 1000,
    });
    const metrics = service.recordPacketLoss({
      peerId: "peer-1",
      packetsSent: 100,
      packetsReceived: 97,
    });

    expect(metrics.download.bitsPerSecond).toBeGreaterThan(0);
    expect(metrics.packetLoss.packetsLost).toBe(3);
  });

  it("updates and unregisters peers", () => {
    service.registerPeer({ peerId: "peer-1", roomId: "room-a", displayName: "Alice" });
    const updated = service.updatePeer("peer-1", { displayName: "Alicia", roomId: "room-b" });

    expect(updated.displayName).toBe("Alicia");
    expect(updated.roomId).toBe("room-b");
    expect(service.unregisterPeer("peer-1")).toBe(true);
    expect(service.hasPeer("peer-1")).toBe(false);
  });

  it("unregisters all peers in a room", () => {
    service.registerPeer({ peerId: "peer-1", roomId: "room-a" });
    service.registerPeer({ peerId: "peer-2", roomId: "room-a" });
    service.registerPeer({ peerId: "peer-3", roomId: "room-b" });

    expect(service.unregisterRoom("room-a")).toBe(2);
    expect(service.hasRoom("room-a")).toBe(false);
    expect(service.hasRoom("room-b")).toBe(true);
  });

  it("lists room and peer metrics", () => {
    service.registerPeer({ peerId: "peer-1", roomId: "room-a" });
    service.registerPeer({ peerId: "peer-2", roomId: "room-b" });

    expect(service.listRoomMetrics()).toHaveLength(2);
    expect(service.listPeerMetrics("room-a")).toHaveLength(1);
    expect(service.listPeerMetrics()).toHaveLength(2);
  });

  it("builds global and room snapshots", () => {
    service.registerPeer({ peerId: "peer-1", roomId: "room-a" });
    service.registerPeer({ peerId: "peer-2", roomId: "room-b" });

    const global = service.buildSnapshot();
    const room = service.buildRoomSnapshot("room-a");

    expect(global.totals.totalPeers).toBe(2);
    expect(room.peers).toHaveLength(1);
    expect(service.stats().lastSnapshotAt).not.toBeNull();
  });

  it("throws when building snapshot for empty room", () => {
    expect(() => service.buildRoomSnapshot("missing")).toThrow(AppError);
  });

  it("records batch samples", () => {
    service.registerPeer({ peerId: "peer-1", roomId: "room-a" });

    const metrics = service.recordBatch("peer-1", {
      latencies: [{ rttMs: 50 }, { rttMs: 55 }],
      bandwidth: [{ direction: "upload", bytesTransferred: 10_000, intervalMs: 1000 }],
      packetLoss: [{ packetsSent: 100, packetsReceived: 98 }],
    });

    expect(metrics.latency.sampleCount).toBe(2);
    expect(metrics.upload.sampleCount).toBe(1);
    expect(metrics.packetLoss.sampleCount).toBe(1);
  });

  it("throws when batch recording for unknown peer", () => {
    expect(() => service.recordBatch("missing", { latencies: [{ rttMs: 50 }] })).toThrow(AppError);
  });

  it("ranks peers by quality", () => {
    service.registerPeer({ peerId: "good", roomId: "room-a" });
    service.recordLatency({ peerId: "good", rttMs: 30 });
    service.recordBandwidth({
      peerId: "good",
      direction: "download",
      bytesTransferred: 50_000,
      intervalMs: 1000,
    });

    service.registerPeer({ peerId: "bad", roomId: "room-a" });
    service.recordLatency({ peerId: "bad", rttMs: 350 });
    service.recordPacketLoss({
      peerId: "bad",
      packetsSent: 100,
      packetsReceived: 70,
      packetsLost: 30,
    });

    const top = service.getTopPeers("room-a", 1);
    const worst = service.getWorstPeers("room-a", 1);
    const below = service.getPeersBelowQuality("room-a", 55);

    expect(top[0].peerId).toBe("good");
    expect(worst[0].peerId).toBe("bad");
    expect(below.some((peer) => peer.peerId === "bad")).toBe(true);
  });

  it("ensures peer exists without duplicate error", () => {
    const first = service.ensurePeer({ peerId: "peer-1", roomId: "room-a" });
    const second = service.ensurePeer({ peerId: "peer-1", roomId: "room-b" });
    expect(first.peerId).toBe("peer-1");
    expect(second.roomId).toBe("room-a");
  });

  it("detects stale peers", () => {
    const now = Date.now();
    service.registerPeer({ peerId: "peer-1", roomId: "room-a", connectedAt: now - 120_000 });
    service.recordLatency({ peerId: "peer-1", rttMs: 50, timestamp: now - 120_000 });
    expect(service.isPeerStale("peer-1", now)).toBe(true);
  });

  it("prunes stale samples and clears state", () => {
    service.registerPeer({ peerId: "peer-1", roomId: "room-a" });
    service.recordLatency({ peerId: "peer-1", rttMs: 50, timestamp: Date.now() - 400_000 });
    expect(service.pruneStale()).toBeGreaterThanOrEqual(0);

    service.clear();
    expect(service.stats().peerCount).toBe(0);
  });

  it("exposes internal components and config", () => {
    expect(service.getStore()).toBeTruthy();
    expect(service.getAggregator()).toBeTruthy();
    expect(service.getSnapshotBuilder()).toBeTruthy();
    expect(service.getBandwidthEstimator()).toBeTruthy();
    expect(service.getConfig().rollingWindow.windowMs).toBeGreaterThan(0);
  });
});
