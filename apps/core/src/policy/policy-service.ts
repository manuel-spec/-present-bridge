import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import {
  type PeerUsageSnapshot,
  type PolicyDecision,
  type PolicyServiceConfig,
  type RateLimitKey,
  type RateLimitResult,
  type RoomPolicyContext,
  PolicyViolationCode,
  createRateLimitKey,
  DEFAULT_ROOM_POLICY_CONFIG,
  mergePolicyConfig,
} from "./types.js";
import { SlidingWindowRateLimiter, MultiRateLimiter } from "./sliding-window-rate-limiter.js";
import { RoomPolicy } from "./room-policy.js";
import { PeerLimits } from "./peer-limits.js";

export class PolicyService {
  private readonly config: PolicyServiceConfig;
  private readonly roomPolicy: RoomPolicy;
  private readonly peerLimits: PeerLimits;
  private readonly rateLimiters: MultiRateLimiter;

  constructor(config: Partial<PolicyServiceConfig> = {}) {
    this.config = mergePolicyConfig(config);
    this.roomPolicy = new RoomPolicy(this.config.room);
    this.peerLimits = new PeerLimits(this.config.peer);
    this.rateLimiters = new MultiRateLimiter();
    this.rateLimiters.register("global", this.config.globalRateLimit);
    this.rateLimiters.register("ip", this.config.perIpRateLimit);
  }

  validateRoomName(roomName: string): PolicyDecision {
    return this.roomPolicy.validateRoomName(roomName);
  }

  canCreateRoom(context: RoomPolicyContext): PolicyDecision {
    return this.roomPolicy.canCreateRoom(context);
  }

  canJoinRoom(context: RoomPolicyContext): PolicyDecision {
    const roomDecision = this.roomPolicy.canJoinRoom(context);
    if (!roomDecision.allowed) {
      return roomDecision;
    }
    return allowedOrPass(roomDecision);
  }

  checkGlobalRateLimit(identifier: string, now?: number): RateLimitResult {
    return this.rateLimiters.check("global", identifier, now);
  }

  checkIpRateLimit(ip: string, now?: number): RateLimitResult {
    return this.rateLimiters.check("ip", ip, now);
  }

  checkRateLimit(key: RateLimitKey, now?: number): RateLimitResult {
    return this.rateLimiters.check(key.namespace, key.identifier, now);
  }

  enforceRateLimit(key: RateLimitKey, now?: number): RateLimitResult {
    const result = this.checkRateLimit(key, now);
    if (!result.allowed) {
      throw this.rateLimitError(result);
    }
    return result;
  }

  enforceGlobalRateLimit(identifier: string, now?: number): RateLimitResult {
    return this.enforceRateLimit(createRateLimitKey("global", identifier), now);
  }

  enforceIpRateLimit(ip: string, now?: number): RateLimitResult {
    return this.enforceRateLimit(createRateLimitKey("ip", ip), now);
  }

  trackPeer(peerId: string): PeerUsageSnapshot {
    return this.peerLimits.trackPeer(peerId);
  }

  untrackPeer(peerId: string): void {
    this.peerLimits.untrackPeer(peerId);
  }

  addTransport(peerId: string): PolicyDecision {
    return this.peerLimits.incrementTransports(peerId);
  }

  removeTransport(peerId: string): void {
    this.peerLimits.decrementTransports(peerId);
  }

  addProducer(peerId: string): PolicyDecision {
    return this.peerLimits.incrementProducers(peerId);
  }

  removeProducer(peerId: string): void {
    this.peerLimits.decrementProducers(peerId);
  }

  addConsumer(peerId: string): PolicyDecision {
    return this.peerLimits.incrementConsumers(peerId);
  }

  removeConsumer(peerId: string): void {
    this.peerLimits.decrementConsumers(peerId);
  }

  recordJoinAttempt(peerId: string, now?: number): PolicyDecision {
    return this.peerLimits.recordJoinAttempt(peerId, now);
  }

  getPeerUsage(peerId: string): PeerUsageSnapshot {
    return this.peerLimits.getUsage(peerId);
  }

  assertAllowed(decision: PolicyDecision): void {
    if (!decision.allowed && decision.violation) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, decision.violation.message);
    }
  }

  assertJoinAllowed(context: RoomPolicyContext, peerId: string, now?: number): void {
    this.assertAllowed(this.canJoinRoom(context));
    this.assertAllowed(this.recordJoinAttempt(peerId, now));
  }

  remainingPeerSlots(currentPeerCount: number): number {
    return this.roomPolicy.remainingPeerSlots(currentPeerCount);
  }

  resetRateLimits(): void {
    this.rateLimiters.resetAll();
  }

  resetPeerLimits(peerId?: string): void {
    this.peerLimits.reset(peerId);
  }

  getConfig(): Readonly<PolicyServiceConfig> {
    return this.config;
  }

  getRoomPolicy(): RoomPolicy {
    return this.roomPolicy;
  }

  getPeerLimits(): PeerLimits {
    return this.peerLimits;
  }

  getRateLimiter(namespace: string): SlidingWindowRateLimiter | undefined {
    return this.rateLimiters.getLimiter(namespace);
  }

  private rateLimitError(result: RateLimitResult): AppError {
    return new AppError(
      ErrorCode.INVALID_MESSAGE,
      `Rate limit exceeded. Retry after ${result.retryAfterMs ?? 0}ms`,
    );
  }
}

function allowedOrPass(decision: PolicyDecision): PolicyDecision {
  return decision;
}

export function createPolicyService(config?: Partial<PolicyServiceConfig>): PolicyService {
  return new PolicyService(config);
}

export function createStrictPolicyService(): PolicyService {
  return createPolicyService({
    room: {
      ...DEFAULT_ROOM_POLICY_CONFIG,
      maxPeersPerRoom: 8,
      reservedRoomNames: new Set(["admin", "system", "health", "metrics", "internal"]),
    },
    peer: {
      maxTransportsPerPeer: 1,
      maxProducersPerPeer: 1,
      maxConsumersPerPeer: 8,
      maxJoinAttemptsPerMinute: 5,
    },
    globalRateLimit: {
      windowMs: 60_000,
      maxRequests: 300,
    },
    perIpRateLimit: {
      windowMs: 60_000,
      maxRequests: 60,
    },
  });
}

export { PolicyViolationCode };
