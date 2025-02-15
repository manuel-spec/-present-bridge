import type { BandwidthSample, MetricDirection, ThroughputEstimate } from "./types.js";
import { emptyThroughputEstimate } from "./types.js";

export interface BandwidthEstimatorOptions {
  windowMs: number;
  minSamplesForTrend?: number;
  trendThresholdRatio?: number;
}

export interface BandwidthBreakdown {
  upload: ThroughputEstimate;
  download: ThroughputEstimate;
  bidirectional: ThroughputEstimate;
}

const DEFAULT_MIN_SAMPLES_FOR_TREND = 3;
const DEFAULT_TREND_THRESHOLD_RATIO = 0.15;

function bytesPerSecondFromSample(sample: BandwidthSample): number {
  if (sample.intervalMs <= 0) {
    return 0;
  }
  return (sample.bytesTransferred * 1000) / sample.intervalMs;
}

function computeTrend(
  rates: number[],
  minSamples: number,
  thresholdRatio: number,
): "rising" | "stable" | "falling" {
  if (rates.length < minSamples) {
    return "stable";
  }

  const midpoint = Math.floor(rates.length / 2);
  const firstHalf = rates.slice(0, midpoint);
  const secondHalf = rates.slice(midpoint);

  if (firstHalf.length === 0 || secondHalf.length === 0) {
    return "stable";
  }

  const firstAvg = firstHalf.reduce((sum, value) => sum + value, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, value) => sum + value, 0) / secondHalf.length;

  if (firstAvg === 0 && secondAvg === 0) {
    return "stable";
  }

  const baseline = Math.max(firstAvg, 1);
  const deltaRatio = (secondAvg - firstAvg) / baseline;

  if (deltaRatio > thresholdRatio) {
    return "rising";
  }
  if (deltaRatio < -thresholdRatio) {
    return "falling";
  }
  return "stable";
}

export class BandwidthEstimator {
  private readonly windowMs: number;
  private readonly minSamplesForTrend: number;
  private readonly trendThresholdRatio: number;

  constructor(options: BandwidthEstimatorOptions) {
    this.windowMs = options.windowMs;
    this.minSamplesForTrend = options.minSamplesForTrend ?? DEFAULT_MIN_SAMPLES_FOR_TREND;
    this.trendThresholdRatio = options.trendThresholdRatio ?? DEFAULT_TREND_THRESHOLD_RATIO;
  }

  estimate(samples: BandwidthSample[], direction: MetricDirection, now: number = Date.now()): ThroughputEstimate {
    const filtered = this.filterSamples(samples, direction, now);

    if (filtered.length === 0) {
      return emptyThroughputEstimate(direction, this.windowMs);
    }

    const rates = filtered.map(bytesPerSecondFromSample);
    const bytesPerSecond = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    const peakBytesPerSecond = Math.max(...rates);
    const trend = computeTrend(rates, this.minSamplesForTrend, this.trendThresholdRatio);

    return {
      direction,
      bytesPerSecond,
      bitsPerSecond: bytesPerSecond * 8,
      sampleCount: filtered.length,
      windowMs: this.windowMs,
      peakBytesPerSecond,
      trend,
    };
  }

  estimateBreakdown(samples: BandwidthSample[], now: number = Date.now()): BandwidthBreakdown {
    return {
      upload: this.estimate(samples, "upload", now),
      download: this.estimate(samples, "download", now),
      bidirectional: this.estimate(samples, "bidirectional", now),
    };
  }

  aggregateEstimates(estimates: ThroughputEstimate[], direction: MetricDirection): ThroughputEstimate {
    if (estimates.length === 0) {
      return emptyThroughputEstimate(direction, this.windowMs);
    }

    const totalBps = estimates.reduce((sum, estimate) => sum + estimate.bytesPerSecond, 0);
    const totalSamples = estimates.reduce((sum, estimate) => sum + estimate.sampleCount, 0);
    const peakBps = Math.max(...estimates.map((estimate) => estimate.peakBytesPerSecond));

    const trendVotes: Record<"rising" | "stable" | "falling", number> = {
      rising: 0,
      stable: 0,
      falling: 0,
    };

    for (const estimate of estimates) {
      trendVotes[estimate.trend] += 1;
    }

    const dominantTrend = (Object.entries(trendVotes) as Array<["rising" | "stable" | "falling", number]>)
      .sort((a, b) => b[1] - a[1])[0][0];

    return {
      direction,
      bytesPerSecond: totalBps,
      bitsPerSecond: totalBps * 8,
      sampleCount: totalSamples,
      windowMs: this.windowMs,
      peakBytesPerSecond: peakBps,
      trend: dominantTrend,
    };
  }

  weightedEstimate(samples: BandwidthSample[], direction: MetricDirection, now: number = Date.now()): ThroughputEstimate {
    const filtered = this.filterSamples(samples, direction, now);

    if (filtered.length === 0) {
      return emptyThroughputEstimate(direction, this.windowMs);
    }

    let weightedSum = 0;
    let weightTotal = 0;
    const rates: number[] = [];

    for (let index = 0; index < filtered.length; index += 1) {
      const sample = filtered[index];
      const rate = bytesPerSecondFromSample(sample);
      const recencyWeight = (index + 1) / filtered.length;
      weightedSum += rate * recencyWeight;
      weightTotal += recencyWeight;
      rates.push(rate);
    }

    const bytesPerSecond = weightTotal > 0 ? weightedSum / weightTotal : 0;

    return {
      direction,
      bytesPerSecond,
      bitsPerSecond: bytesPerSecond * 8,
      sampleCount: filtered.length,
      windowMs: this.windowMs,
      peakBytesPerSecond: Math.max(...rates),
      trend: computeTrend(rates, this.minSamplesForTrend, this.trendThresholdRatio),
    };
  }

  percentileRate(samples: BandwidthSample[], direction: MetricDirection, percentile: number, now: number = Date.now()): number {
    const filtered = this.filterSamples(samples, direction, now);
    if (filtered.length === 0) {
      return 0;
    }

    const clampedPercentile = Math.min(100, Math.max(0, percentile));
    const rates = filtered.map(bytesPerSecondFromSample).sort((a, b) => a - b);
    const index = Math.ceil((clampedPercentile / 100) * rates.length) - 1;
    return rates[Math.max(0, index)];
  }

  sufficientBandwidth(
    estimate: ThroughputEstimate,
    requiredBytesPerSecond: number,
    marginRatio: number = 0.2,
  ): boolean {
    const requiredWithMargin = requiredBytesPerSecond * (1 + marginRatio);
    return estimate.bytesPerSecond >= requiredWithMargin;
  }

  private filterSamples(
    samples: BandwidthSample[],
    direction: MetricDirection,
    now: number,
  ): BandwidthSample[] {
    const cutoff = now - this.windowMs;
    return samples.filter((sample) => {
      if (sample.timestamp < cutoff) {
        return false;
      }
      if (direction === "bidirectional") {
        return sample.direction === "bidirectional";
      }
      return sample.direction === direction || sample.direction === "bidirectional";
    });
  }
}

export function estimateBandwidthFromSamples(
  samples: BandwidthSample[],
  direction: MetricDirection,
  windowMs: number,
  now: number = Date.now(),
): ThroughputEstimate {
  const estimator = new BandwidthEstimator({ windowMs });
  return estimator.estimate(samples, direction, now);
}

export function sumThroughput(estimates: ThroughputEstimate[]): { bytesPerSecond: number; bitsPerSecond: number } {
  const bytesPerSecond = estimates.reduce((sum, estimate) => sum + estimate.bytesPerSecond, 0);
  return {
    bytesPerSecond,
    bitsPerSecond: bytesPerSecond * 8,
  };
}
