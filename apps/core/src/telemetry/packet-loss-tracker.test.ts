import { beforeEach, describe, expect, it } from "vitest";
import type { PacketLossSample } from "./types.js";
import {
  PacketLossTracker,
  computePacketLossRate,
  isAcceptablePacketLoss,
} from "./packet-loss-tracker.js";

const WINDOW_MS = 30_000;
const NOW = 1_700_000_000_000;

function lossSample(
  sent: number,
  received: number,
  lost?: number,
  offsetMs: number = 0,
): PacketLossSample {
  return {
    timestamp: NOW - offsetMs,
    packetsSent: sent,
    packetsReceived: received,
    packetsLost: lost ?? sent - received,
  };
}

describe("PacketLossTracker", () => {
  let tracker: PacketLossTracker;

  beforeEach(() => {
    tracker = new PacketLossTracker({ windowMs: WINDOW_MS });
  });

  it("returns empty stats when no samples", () => {
    const stats = tracker.compute([], NOW);
    expect(stats.lossRate).toBe(0);
    expect(stats.sampleCount).toBe(0);
  });

  it("computes aggregate loss rate", () => {
    const samples = [lossSample(100, 95, 5, 1000), lossSample(200, 190, 10, 2000)];
    const stats = tracker.compute(samples, NOW);

    expect(stats.packetsSent).toBe(300);
    expect(stats.packetsReceived).toBe(285);
    expect(stats.packetsLost).toBe(15);
    expect(stats.lossRate).toBeCloseTo(0.05);
    expect(stats.sampleCount).toBe(2);
  });

  it("filters samples outside window", () => {
    const samples = [
      lossSample(100, 90, 10, 1000),
      lossSample(100, 50, 50, WINDOW_MS + 5000),
    ];
    const stats = tracker.compute(samples, NOW);
    expect(stats.packetsSent).toBe(100);
    expect(stats.lossRate).toBeCloseTo(0.1);
  });

  it("applies exponential smoothing", () => {
    tracker.computeSmoothed([lossSample(100, 90, 10)], NOW);
    const smoothed = tracker.computeSmoothed([lossSample(100, 99, 1)], NOW);

    expect(smoothed.lossRate).toBeGreaterThan(0.01);
    expect(smoothed.lossRate).toBeLessThan(0.1);
  });

  it("returns no windows for invalid bucket counts", () => {
    expect(tracker.computeWindows([lossSample(100, 90, 10)], 0, NOW)).toEqual([]);
    expect(tracker.computeWindows([], 3, NOW)).toEqual([]);
  });

  it("computes time-bucketed windows", () => {
    const samples = [
      lossSample(100, 95, 5, 25_000),
      lossSample(100, 90, 10, 15_000),
      lossSample(100, 80, 20, 5000),
    ];
    const windows = tracker.computeWindows(samples, 3, NOW);

    expect(windows).toHaveLength(3);
    expect(windows[2].packetsSent).toBeGreaterThanOrEqual(0);
  });

  it("detects improving loss trend", () => {
    const samples = [
      lossSample(100, 70, 30, 20_000),
      lossSample(100, 75, 25, 18_000),
      lossSample(100, 98, 2, 2000),
      lossSample(100, 99, 1, 1000),
    ];
    const trend = tracker.computeTrend(samples, NOW);
    expect(trend.direction).toBe("improving");
    expect(trend.delta).toBeLessThan(0);
  });

  it("detects degrading loss trend", () => {
    const samples = [
      lossSample(100, 99, 1, 20_000),
      lossSample(100, 98, 2, 18_000),
      lossSample(100, 70, 30, 2000),
      lossSample(100, 60, 40, 1000),
    ];
    const trend = tracker.computeTrend(samples, NOW);
    expect(trend.direction).toBe("degrading");
    expect(trend.delta).toBeGreaterThan(0);
  });

  it("aggregates room-level loss from peers", () => {
    const peerStats = [
      tracker.compute([lossSample(100, 95, 5)], NOW),
      tracker.compute([lossSample(200, 180, 20)], NOW),
    ];
    const roomStats = tracker.aggregateRoomLoss(peerStats);

    expect(roomStats.packetsSent).toBe(300);
    expect(roomStats.packetsLost).toBe(25);
    expect(roomStats.lossRate).toBeCloseTo(25 / 300);
  });

  it("checks threshold exceedance", () => {
    const stats = tracker.compute([lossSample(100, 80, 20)], NOW);
    expect(tracker.exceedsThreshold(stats, 0.15)).toBe(true);
    expect(tracker.exceedsThreshold(stats, 0.25)).toBe(false);
  });

  it("resets smoothing state", () => {
    tracker.computeSmoothed([lossSample(100, 50, 50)], NOW);
    tracker.resetSmoothing();
    const fresh = tracker.computeSmoothed([lossSample(100, 99, 1)], NOW);
    expect(fresh.lossRate).toBeCloseTo(0.01);
  });

  it("returns empty room aggregate and stable trend", () => {
    expect(tracker.aggregateRoomLoss([]).sampleCount).toBe(0);

    const stableSamples = [
      lossSample(100, 95, 5, 20_000),
      lossSample(100, 94, 6, 18_000),
      lossSample(100, 95, 5, 2000),
      lossSample(100, 94, 6, 1000),
    ];
    expect(tracker.computeTrend(stableSamples, NOW).direction).toBe("stable");
  });

  it("filters samples by transport kind", () => {
    const samples = [
      { ...lossSample(100, 90, 10, 1000), transportKind: "audio" as const },
      { ...lossSample(100, 80, 20, 1000), transportKind: "video" as const },
    ];
    const audioOnly = tracker.compute(samples, NOW, "audio");
    expect(audioOnly.packetsSent).toBe(100);
    expect(audioOnly.packetsLost).toBe(10);
  });

  it("returns unchanged stats when smoothed input is empty", () => {
    const stats = tracker.computeSmoothed([], NOW);
    expect(stats.sampleCount).toBe(0);
    expect(stats.lossRate).toBe(0);
  });

  it("handles zero packet totals in aggregation", () => {
    expect(tracker.compute([], NOW).lossRate).toBe(0);
  });

  it("exports helper functions", () => {
    const rate = computePacketLossRate([lossSample(100, 90, 10)], WINDOW_MS, NOW);
    expect(rate).toBeCloseTo(0.1);
    expect(isAcceptablePacketLoss(0.03)).toBe(true);
    expect(isAcceptablePacketLoss(0.08)).toBe(false);
  });
});
