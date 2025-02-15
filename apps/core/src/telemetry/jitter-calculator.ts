import type { JitterStats, LatencySample, TransportKind } from "./types.js";
import { emptyJitterStats } from "./types.js";

export interface JitterCalculatorOptions {
  windowMs: number;
  useRfc3550?: boolean;
}

export interface LatencyPercentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface JitterTrend {
  currentJitterMs: number;
  previousJitterMs: number;
  delta: number;
  direction: "improving" | "stable" | "degrading";
}

export class JitterCalculator {
  private readonly windowMs: number;
  private readonly useRfc3550: boolean;
  private lastRfcJitter: number | null = null;

  constructor(options: JitterCalculatorOptions) {
    this.windowMs = options.windowMs;
    this.useRfc3550 = options.useRfc3550 ?? true;
  }

  compute(samples: LatencySample[], now: number = Date.now(), transportKind?: TransportKind): JitterStats {
    const filtered = this.filterSamples(samples, now, transportKind);
    const latencies = filtered.map((sample) => sample.rttMs);

    if (latencies.length === 0) {
      return emptyJitterStats(this.windowMs);
    }

    const meanLatencyMs = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
    const minLatencyMs = Math.min(...latencies);
    const maxLatencyMs = Math.max(...latencies);

    const jitterMs = this.useRfc3550
      ? this.computeRfc3550Jitter(filtered)
      : this.computeStandardDeviation(latencies, meanLatencyMs);

    return {
      jitterMs,
      meanLatencyMs,
      minLatencyMs,
      maxLatencyMs,
      sampleCount: filtered.length,
      windowMs: this.windowMs,
    };
  }

  computePercentiles(samples: LatencySample[], now: number = Date.now()): LatencyPercentiles {
    const filtered = this.filterSamples(samples, now);
    if (filtered.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0 };
    }

    const sorted = filtered.map((sample) => sample.rttMs).sort((a, b) => a - b);

    return {
      p50: this.percentile(sorted, 50),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
    };
  }

  computeTrend(samples: LatencySample[], now: number = Date.now()): JitterTrend {
    const midpoint = now - this.windowMs / 2;
    const recent = this.filterSamples(samples, now).filter((sample) => sample.timestamp >= midpoint);
    const older = this.filterSamples(samples, now).filter((sample) => sample.timestamp < midpoint);

    const recentJitter = this.compute(recent, now).jitterMs;
    const olderJitter = this.compute(older, now).jitterMs;
    const delta = recentJitter - olderJitter;

    let direction: JitterTrend["direction"] = "stable";
    if (delta < -2) {
      direction = "improving";
    } else if (delta > 2) {
      direction = "degrading";
    }

    return {
      currentJitterMs: recentJitter,
      previousJitterMs: olderJitter,
      delta,
      direction,
    };
  }

  aggregateRoomJitter(peerStats: JitterStats[]): JitterStats {
    if (peerStats.length === 0) {
      return emptyJitterStats(this.windowMs);
    }

    const totalSamples = peerStats.reduce((sum, stats) => sum + stats.sampleCount, 0);
    const weightedJitter =
      peerStats.reduce((sum, stats) => sum + stats.jitterMs * stats.sampleCount, 0) / Math.max(totalSamples, 1);
    const weightedLatency =
      peerStats.reduce((sum, stats) => sum + stats.meanLatencyMs * stats.sampleCount, 0) / Math.max(totalSamples, 1);

    return {
      jitterMs: weightedJitter,
      meanLatencyMs: weightedLatency,
      minLatencyMs: Math.min(...peerStats.map((stats) => stats.minLatencyMs)),
      maxLatencyMs: Math.max(...peerStats.map((stats) => stats.maxLatencyMs)),
      sampleCount: totalSamples,
      windowMs: this.windowMs,
    };
  }

  resetRfcState(): void {
    this.lastRfcJitter = null;
  }

  private computeRfc3550Jitter(samples: LatencySample[]): number {
    if (samples.length < 2) {
      return 0;
    }

    let jitter = this.lastRfcJitter ?? 0;

    for (let index = 1; index < samples.length; index += 1) {
      const current = samples[index].rttMs;
      const previous = samples[index - 1].rttMs;
      const delta = Math.abs(current - previous);
      jitter += (delta - jitter) / 16;
    }

    this.lastRfcJitter = jitter;
    return jitter;
  }

  private computeStandardDeviation(values: number[], mean: number): number {
    if (values.length < 2) {
      return 0;
    }

    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);

    return Math.sqrt(variance);
  }

  private percentile(sorted: number[], percentile: number): number {
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
  }

  private filterSamples(
    samples: LatencySample[],
    now: number,
    transportKind?: TransportKind,
  ): LatencySample[] {
    const cutoff = now - this.windowMs;
    return samples
      .filter((sample) => sample.timestamp >= cutoff)
      .filter((sample) => {
        if (!transportKind || !sample.transportKind) {
          return true;
        }
        return sample.transportKind === transportKind;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

export function computeJitterFromLatencies(latencies: number[]): number {
  if (latencies.length < 2) {
    return 0;
  }

  let jitter = 0;
  for (let index = 1; index < latencies.length; index += 1) {
    const delta = Math.abs(latencies[index] - latencies[index - 1]);
    jitter += (delta - jitter) / 16;
  }

  return jitter;
}

export function meanLatency(samples: LatencySample[], windowMs: number, now: number = Date.now()): number {
  const calculator = new JitterCalculator({ windowMs });
  return calculator.compute(samples, now).meanLatencyMs;
}
