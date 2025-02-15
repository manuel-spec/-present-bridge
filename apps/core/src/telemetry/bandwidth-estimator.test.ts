import { describe, expect, it } from "vitest";
import type { BandwidthSample } from "./types.js";
import { BandwidthEstimator, estimateBandwidthFromSamples, sumThroughput } from "./bandwidth-estimator.js";

const WINDOW_MS = 30_000;
const NOW = 1_700_000_000_000;

function sample(
  bytes: number,
  intervalMs: number,
  direction: BandwidthSample["direction"] = "download",
  offsetMs: number = 0,
): BandwidthSample {
  return {
    timestamp: NOW - offsetMs,
    direction,
    bytesTransferred: bytes,
    intervalMs,
  };
}

describe("BandwidthEstimator", () => {
  const estimator = new BandwidthEstimator({ windowMs: WINDOW_MS });

  it("returns empty estimate when no samples", () => {
    const estimate = estimator.estimate([], "download", NOW);
    expect(estimate.bytesPerSecond).toBe(0);
    expect(estimate.sampleCount).toBe(0);
    expect(estimate.trend).toBe("stable");
  });

  it("estimates download throughput from samples", () => {
    const samples = [
      sample(10_000, 1000, "download", 5000),
      sample(20_000, 1000, "download", 3000),
    ];
    const estimate = estimator.estimate(samples, "download", NOW);

    expect(estimate.bytesPerSecond).toBe(15_000);
    expect(estimate.bitsPerSecond).toBe(120_000);
    expect(estimate.sampleCount).toBe(2);
    expect(estimate.peakBytesPerSecond).toBe(20_000);
  });

  it("filters samples outside window", () => {
    const samples = [
      sample(10_000, 1000, "download", 5000),
      sample(50_000, 1000, "download", WINDOW_MS + 1000),
    ];
    const estimate = estimator.estimate(samples, "download", NOW);
    expect(estimate.sampleCount).toBe(1);
    expect(estimate.bytesPerSecond).toBe(10_000);
  });

  it("includes bidirectional samples for upload and download", () => {
    const samples = [sample(8000, 1000, "bidirectional", 1000)];
    const upload = estimator.estimate(samples, "upload", NOW);
    const download = estimator.estimate(samples, "download", NOW);

    expect(upload.bytesPerSecond).toBe(8000);
    expect(download.bytesPerSecond).toBe(8000);
  });

  it("detects rising bandwidth trend", () => {
    const samples = [
      sample(5000, 1000, "download", 9000),
      sample(6000, 1000, "download", 8000),
      sample(10_000, 1000, "download", 1000),
      sample(12_000, 1000, "download", 500),
    ];
    const estimate = estimator.estimate(samples, "download", NOW);
    expect(estimate.trend).toBe("rising");
  });

  it("detects falling bandwidth trend", () => {
    const samples = [
      sample(20_000, 1000, "download", 9000),
      sample(18_000, 1000, "download", 8000),
      sample(5000, 1000, "download", 1000),
      sample(4000, 1000, "download", 500),
    ];
    const estimate = estimator.estimate(samples, "download", NOW);
    expect(estimate.trend).toBe("falling");
  });

  it("computes breakdown for all directions", () => {
    const samples = [
      sample(10_000, 1000, "upload", 1000),
      sample(20_000, 1000, "download", 1000),
      sample(5000, 1000, "bidirectional", 1000),
    ];
    const breakdown = estimator.estimateBreakdown(samples, NOW);

    expect(breakdown.upload.bytesPerSecond).toBe(7500);
    expect(breakdown.download.bytesPerSecond).toBe(12_500);
    expect(breakdown.bidirectional.bytesPerSecond).toBe(5000);
  });

  it("aggregates multiple peer estimates", () => {
    const estimates = [
      estimator.estimate([sample(10_000, 1000)], "download", NOW),
      estimator.estimate([sample(20_000, 1000)], "download", NOW),
    ];
    const aggregated = estimator.aggregateEstimates(estimates, "download");

    expect(aggregated.bytesPerSecond).toBe(30_000);
    expect(aggregated.sampleCount).toBe(2);
  });

  it("computes weighted estimate favoring recent samples", () => {
    const samples = [
      sample(5000, 1000, "download", 5000),
      sample(20_000, 1000, "download", 1000),
    ];
    const weighted = estimator.weightedEstimate(samples, "download", NOW);
    const simple = estimator.estimate(samples, "download", NOW);

    expect(weighted.bytesPerSecond).toBeGreaterThan(simple.bytesPerSecond);
  });

  it("computes percentile rate", () => {
    const samples = [
      sample(1000, 1000, "download", 5000),
      sample(5000, 1000, "download", 4000),
      sample(10_000, 1000, "download", 3000),
      sample(20_000, 1000, "download", 2000),
    ];
    expect(estimator.percentileRate(samples, "download", 50, NOW)).toBe(5000);
    expect(estimator.percentileRate(samples, "download", 90, NOW)).toBe(20_000);
  });

  it("checks sufficient bandwidth with margin", () => {
    const estimate = estimator.estimate([sample(12_000, 1000)], "download", NOW);
    expect(estimator.sufficientBandwidth(estimate, 10_000, 0.2)).toBe(true);
    expect(estimator.sufficientBandwidth(estimate, 10_000, 0.25)).toBe(false);
  });

  it("reports stable trend with insufficient samples", () => {
    const estimate = estimator.estimate([sample(1000, 1000, "download", 1000)], "download", NOW);
    expect(estimate.trend).toBe("stable");
  });

  it("returns empty aggregate estimate for no peer data", () => {
    const empty = estimator.aggregateEstimates([], "download");
    expect(empty.sampleCount).toBe(0);
    expect(empty.bytesPerSecond).toBe(0);
  });

  it("returns empty weighted and percentile results", () => {
    expect(estimator.weightedEstimate([], "download", NOW).sampleCount).toBe(0);
    expect(estimator.percentileRate([], "download", 50, NOW)).toBe(0);
    expect(estimator.estimate([], "download", NOW).trend).toBe("stable");
  });

  it("reports stable trend when rates stay within threshold", () => {
    const samples = [
      sample(10_000, 1000, "download", 4000),
      sample(10_200, 1000, "download", 3000),
      sample(10_100, 1000, "download", 2000),
      sample(10_150, 1000, "download", 1000),
    ];
    const estimate = estimator.estimate(samples, "download", NOW);
    expect(estimate.trend).toBe("stable");
  });

  it("reports stable trend for zero-throughput samples", () => {
    const samples = [
      sample(0, 1000, "download", 3000),
      sample(0, 1000, "download", 2000),
      sample(0, 1000, "download", 1000),
      sample(0, 1000, "download", 500),
    ];
    const estimate = estimator.estimate(samples, "download", NOW);
    expect(estimate.trend).toBe("stable");
  });

  it("uses dominant peer trend when aggregating estimates", () => {
    const rising = estimator.estimate(
      [
        sample(5000, 1000, "download", 9000),
        sample(6000, 1000, "download", 8000),
        sample(10_000, 1000, "download", 1000),
        sample(12_000, 1000, "download", 500),
      ],
      "download",
      NOW,
    );
    const falling = estimator.estimate(
      [
        sample(20_000, 1000, "download", 9000),
        sample(18_000, 1000, "download", 8000),
        sample(5000, 1000, "download", 1000),
        sample(4000, 1000, "download", 500),
      ],
      "download",
      NOW,
    );
    const stable = estimator.estimate(
      [
        sample(10_000, 1000, "download", 4000),
        sample(10_100, 1000, "download", 3000),
        sample(10_050, 1000, "download", 2000),
        sample(10_080, 1000, "download", 1000),
      ],
      "download",
      NOW,
    );

    const aggregated = estimator.aggregateEstimates(
      [rising, falling, stable, stable],
      "download",
    );
    expect(aggregated.trend).toBe("stable");
    expect(aggregated.bytesPerSecond).toBeGreaterThan(0);
  });

  it("supports single-sample trend evaluation", () => {
    const singleSampleEstimator = new BandwidthEstimator({
      windowMs: WINDOW_MS,
      minSamplesForTrend: 1,
    });
    const estimate = singleSampleEstimator.estimate(
      [sample(1000, 1000, "download", 1000)],
      "download",
      NOW,
    );
    expect(estimate.trend).toBe("stable");
  });

  it("exports helper functions", () => {
    const estimate = estimateBandwidthFromSamples([sample(8000, 1000, "upload")], "upload", WINDOW_MS, NOW);
    expect(estimate.bytesPerSecond).toBe(8000);

    const sum = sumThroughput([
      estimator.estimate([sample(5000, 1000, "upload")], "upload", NOW),
      estimator.estimate([sample(7000, 1000, "upload")], "upload", NOW),
    ]);
    expect(sum.bytesPerSecond).toBe(12_000);
    expect(sum.bitsPerSecond).toBe(96_000);
  });
});
