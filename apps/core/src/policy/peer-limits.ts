import { ErrorCode } from "@bridge-packet/shared";
import { AppError } from "../lib/errors.js";
import {
  type PeerLimitsConfig,
  type PeerUsageSnapshot,
  type PolicyDecision,
  PolicyViolationCode,
  DEFAULT_PEER_LIMITS_CONFIG,
  allowedDecision,
  createViolation,
  deniedDecision,
} from "./types.js";

interface MutablePeerUsage {
  transports: number;
  producers: number;
  consumers: number;
  joinAttempts: number;
  joinAttemptTimestamps: number[];
}

export class PeerLimits {
  private readonly config: PeerLimitsConfig;
  private readonly usage = new Map<string, MutablePeerUsage>();

  constructor(config: Partial<PeerLimitsConfig> = {}) {
    this.config = { ...DEFAULT_PEER_LIMITS_CONFIG, ...config };
  }

  trackPeer(peerId: string): PeerUsageSnapshot {
    const usage = this.getOrCreate(peerId);
    return this.snapshot(peerId, usage);
  }

  untrackPeer(peerId: string): void {
    this.usage.delete(peerId);
  }

  incrementTransports(peerId: string): PolicyDecision {
    const usage = this.getOrCreate(peerId);
    if (usage.transports >= this.config.maxTransportsPerPeer) {
      return deniedDecision(
        createViolation(
          PolicyViolationCode.TRANSPORT_LIMIT_EXCEEDED,
          `Peer exceeded transport limit of ${this.config.maxTransportsPerPeer}`,
          { peerId, current: usage.transports },
        ),
      );
    }
    usage.transports += 1;
    return allowedDecision();
  }

  decrementTransports(peerId: string): void {
    const usage = this.usage.get(peerId);
    if (usage && usage.transports > 0) {
      usage.transports -= 1;
    }
  }

  incrementProducers(peerId: string): PolicyDecision {
    const usage = this.getOrCreate(peerId);
    if (usage.producers >= this.config.maxProducersPerPeer) {
      return deniedDecision(
        createViolation(
          PolicyViolationCode.PRODUCER_LIMIT_EXCEEDED,
          `Peer exceeded producer limit of ${this.config.maxProducersPerPeer}`,
          { peerId, current: usage.producers },
        ),
      );
    }
    usage.producers += 1;
    return allowedDecision();
  }

  decrementProducers(peerId: string): void {
    const usage = this.usage.get(peerId);
    if (usage && usage.producers > 0) {
      usage.producers -= 1;
    }
  }

  incrementConsumers(peerId: string): PolicyDecision {
    const usage = this.getOrCreate(peerId);
    if (usage.consumers >= this.config.maxConsumersPerPeer) {
      return deniedDecision(
        createViolation(
          PolicyViolationCode.CONSUMER_LIMIT_EXCEEDED,
          `Peer exceeded consumer limit of ${this.config.maxConsumersPerPeer}`,
          { peerId, current: usage.consumers },
        ),
      );
    }
    usage.consumers += 1;
    return allowedDecision();
  }

  decrementConsumers(peerId: string): void {
    const usage = this.usage.get(peerId);
    if (usage && usage.consumers > 0) {
      usage.consumers -= 1;
    }
  }

  recordJoinAttempt(peerId: string, now = Date.now()): PolicyDecision {
    const usage = this.getOrCreate(peerId);
    const windowStart = now - 60_000;
    usage.joinAttemptTimestamps = usage.joinAttemptTimestamps.filter((ts) => ts > windowStart);
    usage.joinAttemptTimestamps.push(now);
    usage.joinAttempts = usage.joinAttemptTimestamps.length;

    if (usage.joinAttempts > this.config.maxJoinAttemptsPerMinute) {
      return deniedDecision(
        createViolation(
          PolicyViolationCode.PEER_LIMIT_EXCEEDED,
          `Peer exceeded join attempt limit of ${this.config.maxJoinAttemptsPerMinute} per minute`,
          { peerId, attempts: usage.joinAttempts },
        ),
      );
    }

    return allowedDecision();
  }

  getUsage(peerId: string): PeerUsageSnapshot {
    const usage = this.usage.get(peerId);
    if (!usage) {
      return {
        peerId,
        transports: 0,
        producers: 0,
        consumers: 0,
        joinAttempts: 0,
      };
    }
    return this.snapshot(peerId, usage);
  }

  assertAllowed(decision: PolicyDecision): void {
    if (!decision.allowed && decision.violation) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, decision.violation.message);
    }
  }

  reset(peerId?: string): void {
    if (peerId) {
      this.usage.delete(peerId);
      return;
    }
    this.usage.clear();
  }

  size(): number {
    return this.usage.size;
  }

  getConfig(): Readonly<PeerLimitsConfig> {
    return this.config;
  }

  private getOrCreate(peerId: string): MutablePeerUsage {
    let usage = this.usage.get(peerId);
    if (!usage) {
      usage = {
        transports: 0,
        producers: 0,
        consumers: 0,
        joinAttempts: 0,
        joinAttemptTimestamps: [],
      };
      this.usage.set(peerId, usage);
    }
    return usage;
  }

  private snapshot(peerId: string, usage: MutablePeerUsage): PeerUsageSnapshot {
    return {
      peerId,
      transports: usage.transports,
      producers: usage.producers,
      consumers: usage.consumers,
      joinAttempts: usage.joinAttempts,
    };
  }
}

export function createPeerLimits(config?: Partial<PeerLimitsConfig>): PeerLimits {
  return new PeerLimits(config);
}
