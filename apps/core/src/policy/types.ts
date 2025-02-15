/**
 * Rate limiting, room policy, and peer limit type definitions.
 */

export const PolicyViolationCode = {
  ROOM_NAME_INVALID: "ROOM_NAME_INVALID",
  ROOM_FULL: "ROOM_FULL",
  PEER_LIMIT_EXCEEDED: "PEER_LIMIT_EXCEEDED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  TRANSPORT_LIMIT_EXCEEDED: "TRANSPORT_LIMIT_EXCEEDED",
  PRODUCER_LIMIT_EXCEEDED: "PRODUCER_LIMIT_EXCEEDED",
  CONSUMER_LIMIT_EXCEEDED: "CONSUMER_LIMIT_EXCEEDED",
} as const;

export type PolicyViolationCode = (typeof PolicyViolationCode)[keyof typeof PolicyViolationCode];

export interface PolicyViolation {
  readonly code: PolicyViolationCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly violation?: PolicyViolation;
}

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly maxRequests: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
  readonly retryAfterMs?: number;
}

export interface RateLimitKey {
  readonly namespace: string;
  readonly identifier: string;
}

export interface RoomPolicyConfig {
  readonly maxPeersPerRoom: number;
  readonly minRoomNameLength: number;
  readonly maxRoomNameLength: number;
  readonly roomNamePattern: RegExp;
  readonly reservedRoomNames: ReadonlySet<string>;
  readonly allowEmptyRoomCreation: boolean;
}

export interface PeerLimitsConfig {
  readonly maxTransportsPerPeer: number;
  readonly maxProducersPerPeer: number;
  readonly maxConsumersPerPeer: number;
  readonly maxJoinAttemptsPerMinute: number;
}

export interface PolicyServiceConfig {
  readonly room: RoomPolicyConfig;
  readonly peer: PeerLimitsConfig;
  readonly globalRateLimit: RateLimitConfig;
  readonly perIpRateLimit: RateLimitConfig;
}

export interface PeerUsageSnapshot {
  readonly peerId: string;
  readonly transports: number;
  readonly producers: number;
  readonly consumers: number;
  readonly joinAttempts: number;
}

export interface RoomPolicyContext {
  readonly roomId: string;
  readonly currentPeerCount: number;
  readonly isNewRoom: boolean;
}

export interface RateLimitMiddlewareOptions {
  readonly namespace?: string;
  readonly keyFromRequest?: (request: import("fastify").FastifyRequest) => string;
  readonly skip?: (request: import("fastify").FastifyRequest) => boolean;
}

export const DEFAULT_ROOM_POLICY_CONFIG: RoomPolicyConfig = {
  maxPeersPerRoom: 32,
  minRoomNameLength: 1,
  maxRoomNameLength: 64,
  roomNamePattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
  reservedRoomNames: new Set(["admin", "system", "health", "metrics"]),
  allowEmptyRoomCreation: true,
};

export const DEFAULT_PEER_LIMITS_CONFIG: PeerLimitsConfig = {
  maxTransportsPerPeer: 2,
  maxProducersPerPeer: 2,
  maxConsumersPerPeer: 16,
  maxJoinAttemptsPerMinute: 10,
};

export const DEFAULT_GLOBAL_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 600,
};

export const DEFAULT_PER_IP_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 120,
};

export const DEFAULT_POLICY_SERVICE_CONFIG: PolicyServiceConfig = {
  room: DEFAULT_ROOM_POLICY_CONFIG,
  peer: DEFAULT_PEER_LIMITS_CONFIG,
  globalRateLimit: DEFAULT_GLOBAL_RATE_LIMIT,
  perIpRateLimit: DEFAULT_PER_IP_RATE_LIMIT,
};

export function createRateLimitKey(namespace: string, identifier: string): RateLimitKey {
  return { namespace, identifier };
}

export function formatRateLimitKey(key: RateLimitKey): string {
  return `${key.namespace}:${key.identifier}`;
}

export function allowedDecision(): PolicyDecision {
  return { allowed: true };
}

export function deniedDecision(violation: PolicyViolation): PolicyDecision {
  return { allowed: false, violation };
}

export function createViolation(
  code: PolicyViolationCode,
  message: string,
  details?: Record<string, unknown>,
): PolicyViolation {
  return Object.freeze({
    code,
    message,
    details: details ? Object.freeze({ ...details }) : undefined,
  });
}

export function mergePolicyConfig(
  partial: Partial<PolicyServiceConfig> & {
    room?: Partial<RoomPolicyConfig>;
    peer?: Partial<PeerLimitsConfig>;
    globalRateLimit?: Partial<RateLimitConfig>;
    perIpRateLimit?: Partial<RateLimitConfig>;
  } = {},
): PolicyServiceConfig {
  return {
    room: {
      ...DEFAULT_ROOM_POLICY_CONFIG,
      ...partial.room,
      reservedRoomNames:
        partial.room?.reservedRoomNames ?? DEFAULT_ROOM_POLICY_CONFIG.reservedRoomNames,
    },
    peer: {
      ...DEFAULT_PEER_LIMITS_CONFIG,
      ...partial.peer,
    },
    globalRateLimit: {
      ...DEFAULT_GLOBAL_RATE_LIMIT,
      ...partial.globalRateLimit,
    },
    perIpRateLimit: {
      ...DEFAULT_PER_IP_RATE_LIMIT,
      ...partial.perIpRateLimit,
    },
  };
}

export function normalizeRoomName(roomName: string): string {
  return roomName.trim();
}

export function isReservedRoomName(roomName: string, reserved: ReadonlySet<string>): boolean {
  return reserved.has(roomName.toLowerCase());
}
