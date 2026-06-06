import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ErrorCode } from "@bridge-packet/shared";
import { AppError } from "../lib/errors.js";
import {
  type AuthConfig,
  type IssueTokenOptions,
  type Permission,
  type RoomTokenPayload,
  type SignedRoomToken,
  normalizePermissions,
  mergeAuthConfig,
} from "./types.js";

const TOKEN_VERSION = 1;
const TOKEN_SEPARATOR = ".";

export interface TokenGeneratorOptions {
  readonly config: AuthConfig;
}

export class TokenGenerator {
  private readonly config: AuthConfig;

  constructor(options: TokenGeneratorOptions) {
    if (!options.config.secret || options.config.secret.length < 16) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        "Auth secret must be at least 16 characters",
      );
    }
    this.config = mergeAuthConfig(options.config);
  }

  issueToken(options: IssueTokenOptions): SignedRoomToken {
    const now = Math.floor(Date.now() / 1000);
    const ttl = options.ttlSeconds ?? this.config.defaultTtlSeconds;

    if (ttl <= 0) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, "Token TTL must be positive");
    }

    const permissions = normalizePermissions(options.permissions);
    if (permissions.length === 0) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, "At least one permission is required");
    }

    const payload: RoomTokenPayload = Object.freeze({
      roomId: options.roomId.trim(),
      subject: options.subject.trim(),
      permissions,
      issuedAt: now,
      expiresAt: now + ttl,
      issuer: this.config.issuer,
      metadata: options.metadata ? Object.freeze({ ...options.metadata }) : undefined,
    });

    this.assertValidPayload(payload);

    const signature = this.signPayload(payload);
    const token = this.encodeToken(payload, signature);

    return { token, payload, signature };
  }

  issueJoinToken(roomId: string, subject: string, ttlSeconds?: number): SignedRoomToken {
    return this.issueToken({
      roomId,
      subject,
      permissions: ["join"],
      ttlSeconds,
    });
  }

  issueCreateToken(roomId: string, subject: string, ttlSeconds?: number): SignedRoomToken {
    return this.issueToken({
      roomId,
      subject,
      permissions: ["create", "join", "admin"],
      ttlSeconds,
    });
  }

  issueAdminToken(
    roomId: string,
    subject: string,
    extraPermissions: readonly Permission[] = [],
    ttlSeconds?: number,
  ): SignedRoomToken {
    const permissions = normalizePermissions([
      "admin",
      "moderate",
      "broadcast",
      "create",
      "join",
      ...extraPermissions,
    ]);

    return this.issueToken({
      roomId,
      subject,
      permissions,
      ttlSeconds,
    });
  }

  rotateSecret(newSecret: string): TokenGenerator {
    return new TokenGenerator({
      config: {
        ...this.config,
        secret: newSecret,
      },
    });
  }

  getConfig(): Readonly<AuthConfig> {
    return this.config;
  }

  createEphemeralSubject(prefix = "peer"): string {
    return `${prefix}-${randomBytes(8).toString("hex")}`;
  }

  signPayload(payload: RoomTokenPayload): string {
    const body = this.serializePayload(payload);
    return createHmac("sha256", this.config.secret).update(body).digest("base64url");
  }

  encodeToken(payload: RoomTokenPayload, signature: string): string {
    const body = this.serializePayload(payload);
    const encodedPayload = Buffer.from(body, "utf8").toString("base64url");
    return `${TOKEN_VERSION}${TOKEN_SEPARATOR}${encodedPayload}${TOKEN_SEPARATOR}${signature}`;
  }

  serializePayload(payload: RoomTokenPayload): string {
    return JSON.stringify({
      v: TOKEN_VERSION,
      roomId: payload.roomId,
      subject: payload.subject,
      permissions: payload.permissions,
      iat: payload.issuedAt,
      exp: payload.expiresAt,
      iss: payload.issuer,
      meta: payload.metadata,
    });
  }

  compareSignatures(expected: string, actual: string): boolean {
    try {
      const expectedBuffer = Buffer.from(expected, "base64url");
      const actualBuffer = Buffer.from(actual, "base64url");
      if (expectedBuffer.length !== actualBuffer.length) {
        return false;
      }
      return timingSafeEqual(expectedBuffer, actualBuffer);
    } catch {
      return false;
    }
  }

  private assertValidPayload(payload: RoomTokenPayload): void {
    if (!payload.roomId) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, "roomId is required for token issuance");
    }

    if (!payload.subject) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, "subject is required for token issuance");
    }

    if (payload.expiresAt <= payload.issuedAt) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, "Token expiry must be after issuedAt");
    }

    const maxTtl = 86400 * 7;
    if (payload.expiresAt - payload.issuedAt > maxTtl) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, "Token TTL exceeds maximum allowed duration");
    }
  }
}

export function createTokenGenerator(secret: string, overrides: Partial<Omit<AuthConfig, "secret">> = {}): TokenGenerator {
  return new TokenGenerator({
    config: mergeAuthConfig({ secret, ...overrides }),
  });
}

export function decodeTokenPayload(encodedPayload: string): RoomTokenPayload {
  const json = Buffer.from(encodedPayload, "base64url").toString("utf8");
  const parsed = JSON.parse(json) as {
    v?: number;
    roomId?: string;
    subject?: string;
    permissions?: string[];
    iat?: number;
    exp?: number;
    iss?: string;
    meta?: Record<string, string>;
  };

  if (parsed.v !== TOKEN_VERSION) {
    throw new AppError(ErrorCode.INVALID_MESSAGE, "Unsupported token version");
  }

  if (!parsed.roomId || !parsed.subject || !parsed.iat || !parsed.exp) {
    throw new AppError(ErrorCode.INVALID_MESSAGE, "Token payload missing required fields");
  }

  const permissions = normalizePermissions(parsed.permissions ?? []);
  if (permissions.length === 0) {
    throw new AppError(ErrorCode.INVALID_MESSAGE, "Token payload has no valid permissions");
  }

  return Object.freeze({
    roomId: parsed.roomId,
    subject: parsed.subject,
    permissions,
    issuedAt: parsed.iat,
    expiresAt: parsed.exp,
    issuer: parsed.iss,
    metadata: parsed.meta ? Object.freeze({ ...parsed.meta }) : undefined,
  });
}

export function parseTokenString(token: string): { encodedPayload: string; signature: string } {
  const parts = token.split(TOKEN_SEPARATOR);
  if (parts.length !== 3) {
    throw new AppError(ErrorCode.INVALID_MESSAGE, "Malformed token structure");
  }

  const [version, encodedPayload, signature] = parts;
  if (version !== String(TOKEN_VERSION) || !encodedPayload || !signature) {
    throw new AppError(ErrorCode.INVALID_MESSAGE, "Malformed token structure");
  }

  return { encodedPayload, signature };
}
