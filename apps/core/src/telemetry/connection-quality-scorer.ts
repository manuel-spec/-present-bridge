import type {
  ConnectionQuality,
  ConnectionQualityGrade,
  JitterStats,
  PacketLossStats,
  QualityWeights,
  ThroughputEstimate,
} from "./types.js";
import { DEFAULT_QUALITY_WEIGHTS, emptyConnectionQuality, gradeFromScore, normalizeQualityWeights } from "./types.js";

export interface QualityThresholds {
  excellentLatencyMs: number;
  goodLatencyMs: number;
  fairLatencyMs: number;
  poorLatencyMs: number;
  excellentJitterMs: number;
  goodJitterMs: number;
  fairJitterMs: number;
  poorJitterMs: number;
  excellentLossRate: number;
  goodLossRate: number;
  fairLossRate: number;
  poorLossRate: number;
  minimumUploadBps: number;
  minimumDownloadBps: number;
  targetUploadBps: number;
  targetDownloadBps: number;
}

export interface QualityScoreInput {
  latency: JitterStats;
  packetLoss: PacketLossStats;
  upload: ThroughputEstimate;
  download: ThroughputEstimate;
  assessedAt?: number;
}

export interface QualityComponentScores {
  latencyScore: number;
  jitterScore: number;
  packetLossScore: number;
  bandwidthScore: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  excellentLatencyMs: 50,
  goodLatencyMs: 100,
  fairLatencyMs: 200,
  poorLatencyMs: 400,
  excellentJitterMs: 10,
  goodJitterMs: 30,
  fairJitterMs: 60,
  poorJitterMs: 120,
  excellentLossRate: 0.005,
  goodLossRate: 0.02,
  fairLossRate: 0.05,
  poorLossRate: 0.1,
  minimumUploadBps: 64_000,
  minimumDownloadBps: 128_000,
  targetUploadBps: 512_000,
  targetDownloadBps: 1_024_000,
};

function scoreFromThresholds(value: number, thresholds: number[], scores: number[]): number {
  if (value <= thresholds[0]) return scores[0];
  if (value <= thresholds[1]) return scores[1];
  if (value <= thresholds[2]) return scores[2];
  if (value <= thresholds[3]) return scores[3];
  return scores[4];
}

function interpolateScore(value: number, low: number, high: number, lowScore: number, highScore: number): number {
  if (value <= low) return lowScore;
  if (value >= high) return highScore;
  const ratio = (value - low) / (high - low);
  return Math.round(lowScore + ratio * (highScore - lowScore));
}

export class ConnectionQualityScorer {
  private readonly weights: QualityWeights;
  private readonly thresholds: QualityThresholds;

  constructor(weights?: Partial<QualityWeights>, thresholds?: Partial<QualityThresholds>) {
    this.weights = normalizeQualityWeights(weights ?? {});
    this.thresholds = { ...DEFAULT_QUALITY_THRESHOLDS, ...thresholds };
  }

  score(input: QualityScoreInput): ConnectionQuality {
    const assessedAt = input.assessedAt ?? Date.now();
    const components = this.scoreComponents(input);

    const weightedScore =
      components.latencyScore * this.weights.latency +
      components.jitterScore * this.weights.jitter +
      components.packetLossScore * this.weights.packetLoss +
      components.bandwidthScore * this.weights.bandwidth;

    const score = Math.round(Math.min(100, Math.max(0, weightedScore)));

    return {
      score,
      grade: gradeFromScore(score),
      latencyScore: components.latencyScore,
      jitterScore: components.jitterScore,
      packetLossScore: components.packetLossScore,
      bandwidthScore: components.bandwidthScore,
      assessedAt,
    };
  }

  scoreComponents(input: QualityScoreInput): QualityComponentScores {
    return {
      latencyScore: this.scoreLatency(input.latency),
      jitterScore: this.scoreJitter(input.latency),
      packetLossScore: this.scorePacketLoss(input.packetLoss),
      bandwidthScore: this.scoreBandwidth(input.upload, input.download),
    };
  }

  scoreLatency(stats: JitterStats): number {
    if (stats.sampleCount === 0) {
      return 0;
    }

    const latency = stats.meanLatencyMs;
    const thresholds = [
      this.thresholds.excellentLatencyMs,
      this.thresholds.goodLatencyMs,
      this.thresholds.fairLatencyMs,
      this.thresholds.poorLatencyMs,
    ];

    return scoreFromThresholds(latency, thresholds, [100, 85, 65, 40, 15]);
  }

  scoreJitter(stats: JitterStats): number {
    if (stats.sampleCount === 0) {
      return 0;
    }

    const jitter = stats.jitterMs;
    const thresholds = [
      this.thresholds.excellentJitterMs,
      this.thresholds.goodJitterMs,
      this.thresholds.fairJitterMs,
      this.thresholds.poorJitterMs,
    ];

    return scoreFromThresholds(jitter, thresholds, [100, 80, 60, 35, 10]);
  }

  scorePacketLoss(stats: PacketLossStats): number {
    if (stats.sampleCount === 0) {
      return 50;
    }

    const lossRate = stats.lossRate;
    const thresholds = [
      this.thresholds.excellentLossRate,
      this.thresholds.goodLossRate,
      this.thresholds.fairLossRate,
      this.thresholds.poorLossRate,
    ];

    return scoreFromThresholds(lossRate, thresholds, [100, 85, 60, 30, 5]);
  }

  scoreBandwidth(upload: ThroughputEstimate, download: ThroughputEstimate): number {
    const uploadScore = this.scoreDirectionBandwidth(
      upload.bitsPerSecond,
      this.thresholds.minimumUploadBps,
      this.thresholds.targetUploadBps,
    );
    const downloadScore = this.scoreDirectionBandwidth(
      download.bitsPerSecond,
      this.thresholds.minimumDownloadBps,
      this.thresholds.targetDownloadBps,
    );

    if (upload.sampleCount === 0 && download.sampleCount === 0) {
      return 0;
    }
    if (upload.sampleCount === 0) {
      return downloadScore;
    }
    if (download.sampleCount === 0) {
      return uploadScore;
    }

    return Math.round(uploadScore * 0.4 + downloadScore * 0.6);
  }

  scoreDirectionBandwidth(bitsPerSecond: number, minimumBps: number, targetBps: number): number {
    if (bitsPerSecond <= 0) {
      return 0;
    }
    if (bitsPerSecond >= targetBps) {
      return 100;
    }
    if (bitsPerSecond <= minimumBps) {
      return interpolateScore(bitsPerSecond, 0, minimumBps, 0, 30);
    }
    return interpolateScore(bitsPerSecond, minimumBps, targetBps, 30, 100);
  }

  compare(left: ConnectionQuality, right: ConnectionQuality): number {
    return left.score - right.score;
  }

  isAcceptable(quality: ConnectionQuality, minimumScore: number = 55): boolean {
    return quality.score >= minimumScore;
  }

  worstGrade(grades: ConnectionQualityGrade[]): ConnectionQualityGrade {
    const order: ConnectionQualityGrade[] = ["critical", "poor", "fair", "good", "excellent"];
    let worstIndex = order.length - 1;

    for (const grade of grades) {
      const index = order.indexOf(grade);
      if (index >= 0 && index < worstIndex) {
        worstIndex = index;
      }
    }

    return order[worstIndex];
  }

  averageScore(qualities: ConnectionQuality[]): number {
    if (qualities.length === 0) {
      return 0;
    }
    const total = qualities.reduce((sum, quality) => sum + quality.score, 0);
    return Math.round(total / qualities.length);
  }

  medianScore(qualities: ConnectionQuality[]): number {
    if (qualities.length === 0) {
      return 0;
    }
    const sorted = qualities.map((quality) => quality.score).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }
    return sorted[mid];
  }

  emptyQuality(assessedAt: number = Date.now()): ConnectionQuality {
    return emptyConnectionQuality(assessedAt);
  }

  getWeights(): QualityWeights {
    return { ...this.weights };
  }

  getThresholds(): QualityThresholds {
    return { ...this.thresholds };
  }
}

export function quickQualityScore(
  latencyMs: number,
  jitterMs: number,
  lossRate: number,
  downloadBps: number,
): number {
  const scorer = new ConnectionQualityScorer();
  const now = Date.now();

  return scorer.score({
    latency: {
      jitterMs,
      meanLatencyMs: latencyMs,
      minLatencyMs: latencyMs,
      maxLatencyMs: latencyMs,
      sampleCount: 1,
      windowMs: 30_000,
    },
    packetLoss: {
      lossRate,
      packetsSent: 100,
      packetsReceived: Math.round(100 * (1 - lossRate)),
      packetsLost: Math.round(100 * lossRate),
      windowMs: 30_000,
      sampleCount: 1,
    },
    upload: {
      direction: "upload",
      bytesPerSecond: 0,
      bitsPerSecond: 0,
      sampleCount: 0,
      windowMs: 30_000,
      peakBytesPerSecond: 0,
      trend: "stable",
    },
    download: {
      direction: "download",
      bytesPerSecond: downloadBps / 8,
      bitsPerSecond: downloadBps,
      sampleCount: 1,
      windowMs: 30_000,
      peakBytesPerSecond: downloadBps / 8,
      trend: "stable",
    },
    assessedAt: now,
  }).score;
}
