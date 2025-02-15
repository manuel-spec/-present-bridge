import { describe, expect, it } from "vitest";
import {
  ConnectionQualityScorer,
  DEFAULT_QUALITY_THRESHOLDS,
  quickQualityScore,
} from "./connection-quality-scorer.js";
import type { JitterStats, PacketLossStats, ThroughputEstimate } from "./types.js";

function latencyStats(mean: number, jitter: number, samples: number = 5): JitterStats {
  return {
    meanLatencyMs: mean,
    jitterMs: jitter,
    minLatencyMs: mean - 10,
    maxLatencyMs: mean + 10,
    sampleCount: samples,
    windowMs: 30_000,
  };
}

function lossStats(rate: number, samples: number = 5): PacketLossStats {
  const sent = 1000;
  const lost = Math.round(sent * rate);
  return {
    lossRate: rate,
    packetsSent: sent,
    packetsReceived: sent - lost,
    packetsLost: lost,
    windowMs: 30_000,
    sampleCount: samples,
  };
}

function throughput(bps: number, direction: ThroughputEstimate["direction"], samples: number = 3): ThroughputEstimate {
  return {
    direction,
    bytesPerSecond: bps / 8,
    bitsPerSecond: bps,
    sampleCount: samples,
    windowMs: 30_000,
    peakBytesPerSecond: bps / 8,
    trend: "stable",
  };
}

describe("ConnectionQualityScorer", () => {
  const scorer = new ConnectionQualityScorer();

  it("scores excellent connection highly", () => {
    const quality = scorer.score({
      latency: latencyStats(30, 5),
      packetLoss: lossStats(0.001),
      upload: throughput(600_000, "upload"),
      download: throughput(1_500_000, "download"),
    });

    expect(quality.score).toBeGreaterThanOrEqual(85);
    expect(quality.grade).toBe("excellent");
  });

  it("scores poor connection low", () => {
    const quality = scorer.score({
      latency: latencyStats(350, 100),
      packetLoss: lossStats(0.12),
      upload: throughput(32_000, "upload"),
      download: throughput(64_000, "download"),
    });

    expect(quality.score).toBeLessThan(40);
    expect(["poor", "critical"]).toContain(quality.grade);
  });

  it("returns zero scores when no latency samples", () => {
    const components = scorer.scoreComponents({
      latency: latencyStats(0, 0, 0),
      packetLoss: lossStats(0),
      upload: throughput(500_000, "upload"),
      download: throughput(1_000_000, "download"),
    });

    expect(components.latencyScore).toBe(0);
    expect(components.jitterScore).toBe(0);
  });

  it("scores packet loss with neutral default when no samples", () => {
    const score = scorer.scorePacketLoss({
      lossRate: 0,
      packetsSent: 0,
      packetsReceived: 0,
      packetsLost: 0,
      windowMs: 30_000,
      sampleCount: 0,
    });
    expect(score).toBe(50);
  });

  it("scores bandwidth with upload/download weighting", () => {
    const uploadOnly = scorer.scoreBandwidth(
      throughput(0, "upload", 0),
      throughput(1_000_000, "download"),
    );
    const both = scorer.scoreBandwidth(
      throughput(500_000, "upload"),
      throughput(1_000_000, "download"),
    );

    expect(uploadOnly).toBeGreaterThan(50);
    expect(both).toBeGreaterThanOrEqual(uploadOnly);
  });

  it("interpolates direction bandwidth between minimum and target", () => {
    const belowMin = scorer.scoreDirectionBandwidth(
      DEFAULT_QUALITY_THRESHOLDS.minimumDownloadBps / 2,
      DEFAULT_QUALITY_THRESHOLDS.minimumDownloadBps,
      DEFAULT_QUALITY_THRESHOLDS.targetDownloadBps,
    );
    const atTarget = scorer.scoreDirectionBandwidth(
      DEFAULT_QUALITY_THRESHOLDS.targetDownloadBps,
      DEFAULT_QUALITY_THRESHOLDS.minimumDownloadBps,
      DEFAULT_QUALITY_THRESHOLDS.targetDownloadBps,
    );

    expect(belowMin).toBeLessThan(30);
    expect(atTarget).toBe(100);
  });

  it("compares and checks acceptability", () => {
    const good = scorer.score({
      latency: latencyStats(40, 8),
      packetLoss: lossStats(0.005),
      upload: throughput(500_000, "upload"),
      download: throughput(1_000_000, "download"),
    });
    const bad = scorer.score({
      latency: latencyStats(300, 80),
      packetLoss: lossStats(0.1),
      upload: throughput(32_000, "upload"),
      download: throughput(64_000, "download"),
    });

    expect(scorer.compare(good, bad)).toBeGreaterThan(0);
    expect(scorer.isAcceptable(good)).toBe(true);
    expect(scorer.isAcceptable(bad)).toBe(false);
  });

  it("computes average and median scores", () => {
    const qualities = [
      scorer.score({
        latency: latencyStats(40, 8),
        packetLoss: lossStats(0.005),
        upload: throughput(500_000, "upload"),
        download: throughput(1_000_000, "download"),
      }),
      scorer.score({
        latency: latencyStats(60, 15),
        packetLoss: lossStats(0.02),
        upload: throughput(400_000, "upload"),
        download: throughput(800_000, "download"),
      }),
    ];

    expect(scorer.averageScore(qualities)).toBeGreaterThan(0);
    expect(scorer.medianScore(qualities)).toBeGreaterThan(0);
    expect(scorer.averageScore([])).toBe(0);
  });

  it("finds worst grade from list", () => {
    expect(scorer.worstGrade(["excellent", "good", "poor"])).toBe("poor");
    expect(scorer.worstGrade(["excellent", "good"])).toBe("good");
  });

  it("exposes weights and thresholds", () => {
    const custom = new ConnectionQualityScorer({ latency: 0.5 }, { goodLatencyMs: 80 });
    expect(custom.getWeights().latency).toBeCloseTo(0.5 / (0.5 + 0.25 + 0.3 + 0.15));
    expect(custom.getThresholds().goodLatencyMs).toBe(80);
  });

  it("quickQualityScore helper produces reasonable value", () => {
    const excellent = quickQualityScore(30, 5, 0.001, 1_000_000);
    const poor = quickQualityScore(300, 80, 0.1, 64_000);
    expect(excellent).toBeGreaterThan(poor);
  });
});
