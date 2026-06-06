import { ErrorCode } from "@bridge-packet/shared";
import { AppError } from "../lib/errors.js";
import {
  type AuthConfig,
  type Permission,
  type RoomTokenPayload,
  type TokenInvalidReason,
  type TokenValidationFailure,
  type TokenValidationOutcome,
  TokenInvalidReason as Reasons,
  createAuthContextFromPayload,
  hasPermission,
  isTokenValidationFailure,
  mergeAuthConfig,
} from "./types.js";
import {
  TokenGenerator,
  decodeTokenPayload,
  parseTokenString,
} from "./token-generator.js";

export interface TokenValidatorOptions {
  readonly config: AuthConfig;
  readonly generator?: TokenGenerator;
}

export class TokenValidator {
  private readonly config: AuthConfig;
  private readonly generator: TokenGenerator;

  constructor(options: TokenValidatorOptions) {
    this.config = mergeAuthConfig(options.config);
    this.generator =
      options.generator ??
      new TokenGenerator({
        config: this.config,
      });
  }

  validate(token: string): TokenValidationOutcome {
    if (!token || token.trim().length === 0) {
      return this.failure(Reasons.MALFORMED, "Token is empty");
    }

    let encodedPayload: string;
    let signature: string;
    let payload: RoomTokenPayload;

    try {
      ({ encodedPayload, signature } = parseTokenString(token.trim()));
      payload = decodeTokenPayload(encodedPayload);
    } catch (error) {
      const message = error instanceof AppError ? error.message : "Malformed token";
      return this.failure(Reasons.MALFORMED, message);
    }

    const expectedSignature = this.generator.signPayload(payload);
    if (!this.generator.compareSignatures(expectedSignature, signature)) {
      return this.failure(Reasons.INVALID_SIGNATURE, "Token signature verification failed");
    }

    const expiryOutcome = this.validateExpiry(payload);
    if (isTokenValidationFailure(expiryOutcome)) {
      return expiryOutcome;
    }

    const payloadOutcome = this.validatePayloadFields(payload);
    if (isTokenValidationFailure(payloadOutcome)) {
      return payloadOutcome;
    }

    return { valid: true, payload };
  }

  validateOrThrow(token: string): RoomTokenPayload {
    const outcome = this.validate(token);
    if (isTokenValidationFailure(outcome)) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, outcome.message);
    }
    return outcome.payload;
  }

  validateForRoom(token: string, roomId: string): TokenValidationOutcome {
    const outcome = this.validate(token);
    if (isTokenValidationFailure(outcome)) {
      return outcome;
    }

    if (outcome.payload.roomId !== roomId) {
      return this.failure(
        Reasons.INVALID_PAYLOAD,
        `Token is not valid for room: ${roomId}`,
      );
    }

    return outcome;
  }

  validatePermission(token: string, required: Permission): TokenValidationOutcome {
    const outcome = this.validate(token);
    if (isTokenValidationFailure(outcome)) {
      return outcome;
    }

    if (!hasPermission(outcome.payload.permissions, required)) {
      return this.failure(
        Reasons.MISSING_PERMISSION,
        `Token missing required permission: ${required}`,
      );
    }

    return outcome;
  }

  validateForRoomAndPermission(
    token: string,
    roomId: string,
    required: Permission,
  ): TokenValidationOutcome {
    const roomOutcome = this.validateForRoom(token, roomId);
    if (isTokenValidationFailure(roomOutcome)) {
      return roomOutcome;
    }

    if (!hasPermission(roomOutcome.payload.permissions, required)) {
      return this.failure(
        Reasons.MISSING_PERMISSION,
        `Token missing required permission: ${required}`,
      );
    }

    return roomOutcome;
  }

  toAuthContext(token: string): ReturnType<typeof createAuthContextFromPayload> | null {
    const outcome = this.validate(token);
    if (isTokenValidationFailure(outcome)) {
      return null;
    }
    return createAuthContextFromPayload(outcome.payload);
  }

  isExpired(payload: RoomTokenPayload, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
    return nowSeconds > payload.expiresAt + this.config.clockSkewSeconds;
  }

  isNotYetValid(payload: RoomTokenPayload, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
    return nowSeconds + this.config.clockSkewSeconds < payload.issuedAt;
  }

  remainingTtlSeconds(payload: RoomTokenPayload, nowSeconds = Math.floor(Date.now() / 1000)): number {
    return Math.max(0, payload.expiresAt - nowSeconds);
  }

  getConfig(): Readonly<AuthConfig> {
    return this.config;
  }

  private validateExpiry(payload: RoomTokenPayload): TokenValidationOutcome {
    const now = Math.floor(Date.now() / 1000);

    if (this.isNotYetValid(payload, now)) {
      return this.failure(Reasons.NOT_YET_VALID, "Token is not yet valid");
    }

    if (this.isExpired(payload, now)) {
      return this.failure(Reasons.EXPIRED, "Token has expired");
    }

    return { valid: true, payload };
  }

  private validatePayloadFields(payload: RoomTokenPayload): TokenValidationOutcome {
    if (!payload.roomId.trim()) {
      return this.failure(Reasons.INVALID_PAYLOAD, "Token roomId is empty");
    }

    if (!payload.subject.trim()) {
      return this.failure(Reasons.INVALID_PAYLOAD, "Token subject is empty");
    }

    if (payload.permissions.length === 0) {
      return this.failure(Reasons.INVALID_PAYLOAD, "Token has no permissions");
    }

    if (payload.issuer && payload.issuer !== this.config.issuer) {
      return this.failure(Reasons.INVALID_PAYLOAD, "Token issuer mismatch");
    }

    return { valid: true, payload };
  }

  private failure(reason: TokenInvalidReason, message: string): TokenValidationFailure {
    return { valid: false, reason, message };
  }
}

export function createTokenValidator(
  secret: string,
  overrides: Partial<Omit<AuthConfig, "secret">> = {},
): TokenValidator {
  const config = mergeAuthConfig({ secret, ...overrides });
  return new TokenValidator({ config });
}

export function assertValidToken(token: string, secret: string): RoomTokenPayload {
  return createTokenValidator(secret).validateOrThrow(token);
}
