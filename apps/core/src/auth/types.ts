/**
 * Authentication and authorization type definitions for room access control.
 */

/** Actions a token holder may perform within a room. */
export const Permission = {
  JOIN: "join",
  CREATE: "create",
  ADMIN: "admin",
  BROADCAST: "broadcast",
  MODERATE: "moderate",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/** All known permissions in evaluation order (least to most privileged). */
export const PERMISSION_HIERARCHY: readonly Permission[] = [
  Permission.JOIN,
  Permission.CREATE,
  Permission.BROADCAST,
  Permission.MODERATE,
  Permission.ADMIN,
] as const;

/** Canonical payload embedded in HMAC-signed room tokens. */
export interface RoomTokenPayload {
  readonly roomId: string;
  readonly subject: string;
  readonly permissions: readonly Permission[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly issuer?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Wire representation of a signed room token. */
export interface SignedRoomToken {
  readonly token: string;
  readonly payload: RoomTokenPayload;
  readonly signature: string;
}

/** Outcome of token validation before policy checks. */
export interface TokenValidationResult {
  readonly valid: true;
  readonly payload: RoomTokenPayload;
}

export interface TokenValidationFailure {
  readonly valid: false;
  readonly reason: TokenInvalidReason;
  readonly message: string;
}

export type TokenValidationOutcome = TokenValidationResult | TokenValidationFailure;

export const TokenInvalidReason = {
  MALFORMED: "malformed",
  INVALID_SIGNATURE: "invalid_signature",
  EXPIRED: "expired",
  NOT_YET_VALID: "not_yet_valid",
  MISSING_PERMISSION: "missing_permission",
  INVALID_PAYLOAD: "invalid_payload",
} as const;

export type TokenInvalidReason = (typeof TokenInvalidReason)[keyof typeof TokenInvalidReason];

/** Configuration for HMAC token generation and validation. */
export interface AuthConfig {
  readonly secret: string;
  readonly defaultTtlSeconds: number;
  readonly clockSkewSeconds: number;
  readonly issuer: string;
  readonly allowAnonymousJoin: boolean;
  readonly allowAnonymousCreate: boolean;
}

export const DEFAULT_AUTH_CONFIG: Omit<AuthConfig, "secret"> = {
  defaultTtlSeconds: 3600,
  clockSkewSeconds: 30,
  issuer: "packet-bridge",
  allowAnonymousJoin: true,
  allowAnonymousCreate: true,
};

/** Resolved auth context attached to Fastify requests after middleware. */
export interface AuthContext {
  readonly authenticated: boolean;
  readonly subject: string | null;
  readonly permissions: readonly Permission[];
  readonly roomId: string | null;
  readonly tokenPayload: RoomTokenPayload | null;
}

export const ANONYMOUS_AUTH_CONTEXT: AuthContext = {
  authenticated: false,
  subject: null,
  permissions: [],
  roomId: null,
  tokenPayload: null,
};

/** Room access request evaluated by room-access-policy. */
export interface RoomAccessRequest {
  readonly action: RoomAccessAction;
  readonly roomId: string;
  readonly subject: string;
  readonly auth: AuthContext;
  readonly currentPeerCount?: number;
}

export const RoomAccessAction = {
  CREATE: "create",
  JOIN: "join",
  ADMIN: "admin",
} as const;

export type RoomAccessAction = (typeof RoomAccessAction)[keyof typeof RoomAccessAction];

export interface RoomAccessDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly requiredPermission?: Permission;
}

/** Options when issuing a new room token. */
export interface IssueTokenOptions {
  readonly roomId: string;
  readonly subject: string;
  readonly permissions: readonly Permission[];
  readonly ttlSeconds?: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Header and query parameter names used for token transport. */
export const AUTH_TOKEN_HEADER = "authorization" as const;
export const AUTH_TOKEN_QUERY_PARAM = "token" as const;
export const AUTH_BEARER_PREFIX = "Bearer " as const;

export function isPermission(value: string): value is Permission {
  return Object.values(Permission).includes(value as Permission);
}

export function normalizePermissions(permissions: readonly string[]): Permission[] {
  const seen = new Set<Permission>();
  const normalized: Permission[] = [];

  for (const raw of permissions) {
    if (!isPermission(raw)) {
      continue;
    }
    if (!seen.has(raw)) {
      seen.add(raw);
      normalized.push(raw);
    }
  }

  return normalized;
}

export function hasPermission(
  held: readonly Permission[],
  required: Permission,
): boolean {
  if (held.includes(Permission.ADMIN)) {
    return true;
  }
  return held.includes(required);
}

export function hasAllPermissions(
  held: readonly Permission[],
  required: readonly Permission[],
): boolean {
  return required.every((permission) => hasPermission(held, permission));
}

export function permissionRank(permission: Permission): number {
  const index = PERMISSION_HIERARCHY.indexOf(permission);
  return index === -1 ? -1 : index;
}

export function maxPermission(permissions: readonly Permission[]): Permission | null {
  if (permissions.length === 0) {
    return null;
  }

  let best: Permission = permissions[0]!;
  let bestRank = permissionRank(best);

  for (let i = 1; i < permissions.length; i += 1) {
    const candidate = permissions[i]!;
    const rank = permissionRank(candidate);
    if (rank > bestRank) {
      best = candidate;
      bestRank = rank;
    }
  }

  return best;
}

export function createAuthContextFromPayload(payload: RoomTokenPayload): AuthContext {
  return {
    authenticated: true,
    subject: payload.subject,
    permissions: [...payload.permissions],
    roomId: payload.roomId,
    tokenPayload: payload,
  };
}

export function isTokenValidationFailure(
  outcome: TokenValidationOutcome,
): outcome is TokenValidationFailure {
  return outcome.valid === false;
}

export function mergeAuthConfig(
  partial: Partial<AuthConfig> & Pick<AuthConfig, "secret">,
): AuthConfig {
  return {
    ...DEFAULT_AUTH_CONFIG,
    ...partial,
  };
}
