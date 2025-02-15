import { beforeEach, describe, expect, it } from "vitest";
import type { LatencySample } from "./types.js";
import {
  JitterCalculator,
  computeJitterFromLatencies,
  meanLatency,
} from "./jitter-calculator.js";

const WINDOW_MS = 30_000;
const NOW = 1_700_000_000_000;

function latency(rttMs: number, offsetMs: number = 0, kind?: LatencySample["transportKind"]): LatencySample {
  return { timestamp: NOW - offsetMs, rttMs, transportKind: kind };
}

describe("JitterCalculator", () => {
  let calculator: JitterCalculator;

  beforeEach(() => {
    calculator = new JitterCalculator({ windowMs: WINDOW_MS, useRfc3550: true });
  });

  it("returns empty stats when no samples", () => {
    const stats = calculator.compute([], NOW);
    expect(stats.jitterMs).toBe(0);
    expect(stats.sampleCount).toBe(0);
  });

  it("computes mean, min, and max latency", () => {
    const samples = [latency(40, 5000), latency(60, 4000), latency(50, 3000)];
    const stats = calculator.compute(samples, NOW);

    expect(stats.meanLatencyMs).toBe(50);
    expect(stats.minLatencyMs).toBe(40);
    expect(stats.maxLatencyMs).toBe(60);
    expect(stats.sampleCount).toBe(3);
  });

  it("computes RFC 3550 jitter", () => {
    const samples = [latency(50, 4000), latency(80, 3000), latency(60, 2000), latency(55, 1000)];
    const stats = calculator.compute(samples, NOW);
    expect(stats.jitterMs).toBeGreaterThan(0);
  });

  it("filters by transport kind", () => {
    const samples = [
      latency(50, 1000, "audio"),
      latency(200, 1000, "video"),
      latency(55, 2000, "audio"),
    ];
    const audioStats = calculator.compute(samples, NOW, "audio");
    expect(audioStats.meanLatencyMs).toBe(52.5);
    expect(audioStats.sampleCount).toBe(2);
  });

  it("computes latency percentiles", () => {
    const samples = [
      latency(10, 5000),
      latency(20, 4000),
      latency(30, 3000),
      latency(40, 2000),
      latency(100, 1000),
    ];
    const percentiles = calculator.computePercentiles(samples, NOW);

    expect(percentiles.p50).toBe(30);
    expect(percentiles.p90).toBe(100);
    expect(percentiles.p95).toBe(100);
    expect(percentiles.p99).toBe(100);
  });

  it("detects improving jitter trend", () => {
    const samples = [
      latency(200, 20_000),
      latency(180, 19_000),
      latency(160, 18_000),
      latency(50, 2000),
      latency(48, 1500),
      latency(52, 1000),
    ];
    const trend = calculator.computeTrend(samples, NOW);
    expect(trend.direction).toBe("improving");
    expect(trend.currentJitterMs).toBeLessThan(trend.previousJitterMs);
  });

  it("detects degrading jitter trend", () => {
    const samples = [
      latency(50, 20_000),
      latency(51, 19_000),
      latency(49, 18_000),
      latency(50, 17_000),
      latency(250, 2000),
      latency(50, 1500),
      latency(300, 1000),
      latency(40, 500),
    ];
    const trend = calculator.computeTrend(samples, NOW);
    expect(trend.currentJitterMs).toBeGreaterThan(trend.previousJitterMs);
    expect(trend.delta).toBeGreaterThan(2);
    expect(trend.direction).toBe("degrading");
  });

  it("aggregates room jitter from peers", () => {
    const peerStats = [
      calculator.compute([latency(50, 1000), latency(60, 2000)], NOW),
      calculator.compute([latency(80, 1000), latency(90, 2000)], NOW),
    ];
    const roomStats = calculator.aggregateRoomJitter(peerStats);

    expect(roomStats.sampleCount).toBe(4);
    expect(roomStats.meanLatencyMs).toBeGreaterThan(0);
    expect(roomStats.minLatencyMs).toBe(50);
    expect(roomStats.maxLatencyMs).toBe(90);
  });

  it("uses standard deviation when RFC mode disabled", () => {
    const stdCalc = new JitterCalculator({ windowMs: WINDOW_MS, useRfc3550: false });
    const samples = [latency(50, 3000), latency(70, 2000), latency(60, 1000)];
    const stats = stdCalc.compute(samples, NOW);
    expect(stats.jitterMs).toBeGreaterThan(0);
  });

  it("resets RFC state", () => {
    calculator.compute([latency(50, 2000), latency(100, 1000)], NOW);
    calculator.resetRfcState();
    const stats = calculator.compute([latency(50, 2000), latency(55, 1000)], NOW);
    expect(stats.jitterMs).toBeGreaterThanOrEqual(0);
  });

  it("exports helper functions", () => {
    const jitter = computeJitterFromLatencies([50, 80, 60, 55]);
    expect(jitter).toBeGreaterThan(0);

    const avg = meanLatency([latency(40, 1000), latency(60, 2000)], WINDOW_MS, NOW);
    expect(avg).toBe(50);
  });
});
