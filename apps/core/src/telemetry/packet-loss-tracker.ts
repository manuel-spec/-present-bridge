import type { PacketLossSample, PacketLossStats, TransportKind } from "./types.js";
import { emptyPacketLossStats } from "./types.js";

export interface PacketLossTrackerOptions {
  windowMs: number;
  smoothingAlpha?: number;
}

export interface PacketLossWindow {
  startTimestamp: number;
  endTimestamp: number;
  packetsSent: number;
  packetsReceived: number;
  packetsLost: number;
  lossRate: number;
}

export interface PacketLossTrend {
  currentLossRate: number;
  previousLossRate: number;
  delta: number;
  direction: "improving" | "stable" | "degrading";
}

const DEFAULT_SMOOTHING_ALPHA = 0.3;

export class PacketLossTracker {
  private readonly windowMs: number;
  private readonly smoothingAlpha: number;
  private smoothedLossRate: number | null = null;

  constructor(options: PacketLossTrackerOptions) {
    this.windowMs = options.windowMs;
    this.smoothingAlpha = options.smoothingAlpha ?? DEFAULT_SMOOTHING_ALPHA;
  }

  compute(samples: PacketLossSample[], now: number = Date.now(), transportKind?: TransportKind): PacketLossStats {
    const filtered = this.filterSamples(samples, now, transportKind);

    if (filtered.length === 0) {
      return emptyPacketLossStats(this.windowMs);
    }

    const totals = filtered.reduce(
      (acc, sample) => ({
        packetsSent: acc.packetsSent + sample.packetsSent,
        packetsReceived: acc.packetsReceived + sample.packetsReceived,
        packetsLost: acc.packetsLost + sample.packetsLost,
      }),
      { packetsSent: 0, packetsReceived: 0, packetsLost: 0 },
    );

    const lossRate = totals.packetsSent > 0 ? totals.packetsLost / totals.packetsSent : 0;

    return {
      lossRate,
      packetsSent: totals.packetsSent,
      packetsReceived: totals.packetsReceived,
      packetsLost: totals.packetsLost,
      windowMs: this.windowMs,
      sampleCount: filtered.length,
      transportKind,
    };
  }

  computeSmoothed(samples: PacketLossSample[], now: number = Date.now(), transportKind?: TransportKind): PacketLossStats {
    const stats = this.compute(samples, now, transportKind);

    if (stats.sampleCount === 0) {
      return stats;
    }

    if (this.smoothedLossRate === null) {
      this.smoothedLossRate = stats.lossRate;
    } else {
      this.smoothedLossRate =
        this.smoothingAlpha * stats.lossRate + (1 - this.smoothingAlpha) * this.smoothedLossRate;
    }

    return {
      ...stats,
      lossRate: this.smoothedLossRate,
    };
  }

  computeWindows(samples: PacketLossSample[], bucketCount: number, now: number = Date.now()): PacketLossWindow[] {
    if (bucketCount <= 0) {
      return [];
    }

    const filtered = this.filterSamples(samples, now);
    if (filtered.length === 0) {
      return [];
    }

    const bucketSizeMs = this.windowMs / bucketCount;
    const windows: PacketLossWindow[] = [];

    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const start = now - this.windowMs + bucket * bucketSizeMs;
      const end = start + bucketSizeMs;

      const bucketSamples = filtered.filter(
        (sample) => sample.timestamp >= start && sample.timestamp < end,
      );

      const totals = bucketSamples.reduce(
        (acc, sample) => ({
          packetsSent: acc.packetsSent + sample.packetsSent,
          packetsReceived: acc.packetsReceived + sample.packetsReceived,
          packetsLost: acc.packetsLost + sample.packetsLost,
        }),
        { packetsSent: 0, packetsReceived: 0, packetsLost: 0 },
      );

      windows.push({
        startTimestamp: start,
        endTimestamp: end,
        packetsSent: totals.packetsSent,
        packetsReceived: totals.packetsReceived,
        packetsLost: totals.packetsLost,
        lossRate: totals.packetsSent > 0 ? totals.packetsLost / totals.packetsSent : 0,
      });
    }

    return windows;
  }

  computeTrend(samples: PacketLossSample[], now: number = Date.now()): PacketLossTrend {
    const midpoint = now - this.windowMs / 2;
    const recent = this.filterSamples(samples, now).filter((sample) => sample.timestamp >= midpoint);
    const older = this.filterSamples(samples, now).filter((sample) => sample.timestamp < midpoint);

    const recentStats = this.aggregateSamples(recent);
    const olderStats = this.aggregateSamples(older);

    const delta = recentStats.lossRate - olderStats.lossRate;

    let direction: PacketLossTrend["direction"] = "stable";
    if (delta < -0.01) {
      direction = "improving";
    } else if (delta > 0.01) {
      direction = "degrading";
    }

    return {
      currentLossRate: recentStats.lossRate,
      previousLossRate: olderStats.lossRate,
      delta,
      direction,
    };
  }

  aggregateRoomLoss(peerStats: PacketLossStats[]): PacketLossStats {
    if (peerStats.length === 0) {
      return emptyPacketLossStats(this.windowMs);
    }

    const totals = peerStats.reduce(
      (acc, stats) => ({
        packetsSent: acc.packetsSent + stats.packetsSent,
        packetsReceived: acc.packetsReceived + stats.packetsReceived,
        packetsLost: acc.packetsLost + stats.packetsLost,
        sampleCount: acc.sampleCount + stats.sampleCount,
      }),
      { packetsSent: 0, packetsReceived: 0, packetsLost: 0, sampleCount: 0 },
    );

    return {
      lossRate: totals.packetsSent > 0 ? totals.packetsLost / totals.packetsSent : 0,
      packetsSent: totals.packetsSent,
      packetsReceived: totals.packetsReceived,
      packetsLost: totals.packetsLost,
      windowMs: this.windowMs,
      sampleCount: totals.sampleCount,
    };
  }

  exceedsThreshold(stats: PacketLossStats, maxLossRate: number): boolean {
    return stats.lossRate > maxLossRate;
  }

  resetSmoothing(): void {
    this.smoothedLossRate = null;
  }

  private aggregateSamples(samples: PacketLossSample[]): { lossRate: number } {
    const totals = samples.reduce(
      (acc, sample) => ({
        packetsSent: acc.packetsSent + sample.packetsSent,
        packetsReceived: acc.packetsReceived + sample.packetsReceived,
        packetsLost: acc.packetsLost + sample.packetsLost,
      }),
      { packetsSent: 0, packetsReceived: 0, packetsLost: 0 },
    );

    return {
      lossRate: totals.packetsSent > 0 ? totals.packetsLost / totals.packetsSent : 0,
    };
  }

  private filterSamples(
    samples: PacketLossSample[],
    now: number,
    transportKind?: TransportKind,
  ): PacketLossSample[] {
    const cutoff = now - this.windowMs;
    return samples.filter((sample) => {
      if (sample.timestamp < cutoff) {
        return false;
      }
      if (transportKind && sample.transportKind && sample.transportKind !== transportKind) {
        return false;
      }
      return true;
    });
  }
}

export function computePacketLossRate(samples: PacketLossSample[], windowMs: number, now: number = Date.now()): number {
  const tracker = new PacketLossTracker({ windowMs });
  return tracker.compute(samples, now).lossRate;
}

export function isAcceptablePacketLoss(lossRate: number, maxLossRate: number = 0.05): boolean {
  return lossRate <= maxLossRate;
}
