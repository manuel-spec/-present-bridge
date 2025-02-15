import { describe, expect, it } from "vitest";
import {
  DEFAULT_TELEMETRY_CONFIG,
  createEmptyPeerMetricsRecord,
  emptyConnectionQuality,
  emptyJitterStats,
  emptyPacketLossStats,
  emptyThroughputEstimate,
  gradeFromScore,
  isValidBandwidthSample,
  isValidLatencySample,
  isValidPacketLossSample,
  mergeTelemetryConfig,
  normalizeQualityWeights,
} from "./types.js";

describe("telemetry types", () => {
  describe("gradeFromScore", () => {
    it("maps score ranges to quality grades", () => {
      expect(gradeFromScore(95)).toBe("excellent");
      expect(gradeFromScore(80)).toBe("good");
      expect(gradeFromScore(60)).toBe("fair");
      expect(gradeFromScore(40)).toBe("poor");
      expect(gradeFromScore(10)).toBe("critical");
    });
  });

  describe("normalizeQualityWeights", () => {
    it("normalizes partial weights to sum to 1", () => {
      const weights = normalizeQualityWeights({ latency: 2, jitter: 2 });
      expect(weights.latency + weights.jitter + weights.packetLoss + weights.bandwidth).toBeCloseTo(1);
    });

    it("falls back to defaults when total is zero", () => {
      const weights = normalizeQualityWeights({ latency: 0, jitter: 0, packetLoss: 0, bandwidth: 0 });
      expect(weights).toEqual(DEFAULT_TELEMETRY_CONFIG.qualityWeights);
    });
  });

  describe("mergeTelemetryConfig", () => {
    it("returns defaults when no partial config provided", () => {
      expect(mergeTelemetryConfig()).toEqual(DEFAULT_TELEMETRY_CONFIG);
    });

    it("merges partial rolling window settings", () => {
      const config = mergeTelemetryConfig({
        rollingWindow: { windowMs: 10_000 },
      });
      expect(config.rollingWindow.windowMs).toBe(10_000);
      expect(config.rollingWindow.maxSamples).toBe(DEFAULT_TELEMETRY_CONFIG.rollingWindow.maxSamples);
    });

    it("merges stale peer threshold", () => {
      const config = mergeTelemetryConfig({ stalePeerThresholdMs: 120_000 });
      expect(config.stalePeerThresholdMs).toBe(120_000);
    });
  });

  describe("sample validators", () => {
    it("validates latency samples", () => {
      expect(isValidLatencySample({ timestamp: Date.now(), rttMs: 50 })).toBe(true);
      expect(isValidLatencySample({ timestamp: Date.now(), rttMs: -1 })).toBe(false);
      expect(isValidLatencySample({ timestamp: NaN, rttMs: 50 })).toBe(false);
    });

    it("validates bandwidth samples", () => {
      expect(
        isValidBandwidthSample({
          timestamp: Date.now(),
          direction: "upload",
          bytesTransferred: 1024,
          intervalMs: 1000,
        }),
      ).toBe(true);
      expect(
        isValidBandwidthSample({
          timestamp: Date.now(),
          direction: "upload",
          bytesTransferred: 1024,
          intervalMs: 50,
        }),
      ).toBe(false);
    });

    it("validates packet loss samples", () => {
      expect(
        isValidPacketLossSample({
          timestamp: Date.now(),
          packetsSent: 100,
          packetsReceived: 95,
          packetsLost: 5,
        }),
      ).toBe(true);
      expect(
        isValidPacketLossSample({
          timestamp: Date.now(),
          packetsSent: 10,
          packetsReceived: 20,
          packetsLost: 5,
        }),
      ).toBe(false);
    });
  });

  describe("empty factories", () => {
    it("creates empty throughput estimate", () => {
      const estimate = emptyThroughputEstimate("download", 30_000);
      expect(estimate.direction).toBe("download");
      expect(estimate.bytesPerSecond).toBe(0);
      expect(estimate.trend).toBe("stable");
    });

    it("creates empty packet loss stats", () => {
      const stats = emptyPacketLossStats(30_000);
      expect(stats.lossRate).toBe(0);
      expect(stats.sampleCount).toBe(0);
    });

    it("creates empty jitter stats", () => {
      const stats = emptyJitterStats(30_000);
      expect(stats.jitterMs).toBe(0);
      expect(stats.meanLatencyMs).toBe(0);
    });

    it("creates empty connection quality", () => {
      const quality = emptyConnectionQuality(Date.now());
      expect(quality.score).toBe(0);
      expect(quality.grade).toBe("critical");
    });

    it("creates empty peer metrics record", () => {
      const record = createEmptyPeerMetricsRecord({
        peerId: "peer-1",
        roomId: "room-1",
        displayName: "Alice",
      });
      expect(record.peerId).toBe("peer-1");
      expect(record.latencySamples).toEqual([]);
      expect(record.bandwidthSamples).toEqual([]);
      expect(record.packetLossSamples).toEqual([]);
    });
  });
});
