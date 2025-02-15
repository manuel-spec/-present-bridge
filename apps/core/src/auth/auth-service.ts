import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import {
  type AuthConfig,
  type AuthContext,
  type IssueTokenOptions,
  type Permission,
  type RoomAccessDecision,
  type RoomAccessRequest,
  type RoomTokenPayload,
  type SignedRoomToken,
  type TokenValidationOutcome,
  ANONYMOUS_AUTH_CONTEXT,
  Permission as Permissions,
  RoomAccessAction,
  createAuthContextFromPayload,
  isTokenValidationFailure,
  mergeAuthConfig,
} from "./types.js";
import { TokenGenerator, createTokenGenerator } from "./token-generator.js";
import { TokenValidator, createTokenValidator } from "./token-validator.js";
import {
  RoomAccessPolicy,
  createRoomAccessPolicy,
  type RoomAccessPolicyConfig,
} from "./room-access-policy.js";

export interface AuthServiceOptions {
  readonly config: AuthConfig;
  readonly policy?: RoomAccessPolicy;
  readonly generator?: TokenGenerator;
  readonly validator?: TokenValidator;
}

export class AuthService {
  private readonly config: AuthConfig;
  private readonly generator: TokenGenerator;
  private readonly validator: TokenValidator;
  private readonly policy: RoomAccessPolicy;

  constructor(options: AuthServiceOptions) {
    this.config = mergeAuthConfig(options.config);
    this.generator = options.generator ?? createTokenGenerator(this.config.secret, this.config);
    this.validator = options.validator ?? createTokenValidator(this.config.secret, this.config);
    this.policy =
      options.policy ??
      createRoomAccessPolicy(this.config.secret, {
        ...this.config,
      });
  }

  issueToken(options: IssueTokenOptions): SignedRoomToken {
    return this.generator.issueToken(options);
  }

  issueJoinToken(roomId: string, subject: string, ttlSeconds?: number): SignedRoomToken {
    return this.generator.issueJoinToken(roomId, subject, ttlSeconds);
  }

  issueCreateToken(roomId: string, subject: string, ttlSeconds?: number): SignedRoomToken {
    return this.generator.issueCreateToken(roomId, subject, ttlSeconds);
  }

  issueAdminToken(
    roomId: string,
    subject: string,
    extraPermissions: readonly Permission[] = [],
    ttlSeconds?: number,
  ): SignedRoomToken {
    return this.generator.issueAdminToken(roomId, subject, extraPermissions, ttlSeconds);
  }

  validateToken(token: string): TokenValidationOutcome {
    return this.validator.validate(token);
  }

  validateTokenOrThrow(token: string): RoomTokenPayload {
    return this.validator.validateOrThrow(token);
  }

  resolveAuthContext(token: string | null | undefined): AuthContext {
    if (!token) {
      return ANONYMOUS_AUTH_CONTEXT;
    }

    const context = this.validator.toAuthContext(token);
    return context ?? ANONYMOUS_AUTH_CONTEXT;
  }

  authenticate(token: string): AuthContext {
    const outcome = this.validator.validate(token);
    if (isTokenValidationFailure(outcome)) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, outcome.message);
    }
    return createAuthContextFromPayload(outcome.payload);
  }

  evaluateAccess(request: RoomAccessRequest): RoomAccessDecision {
    return this.policy.evaluate(request);
  }

  assertAccess(request: RoomAccessRequest): void {
    this.policy.evaluateOrThrow(request);
  }

  canCreateRoom(auth: AuthContext, roomId: string, subject: string): RoomAccessDecision {
    return this.policy.canCreateRoom(auth, roomId, subject);
  }

  canJoinRoom(
    auth: AuthContext,
    roomId: string,
    subject: string,
    currentPeerCount = 0,
  ): RoomAccessDecision {
    return this.policy.canJoinRoom(auth, roomId, subject, currentPeerCount);
  }

  canAdminRoom(auth: AuthContext, roomId: string, subject: string): RoomAccessDecision {
    return this.policy.canAdminRoom(auth, roomId, subject);
  }

  authorizeCreate(roomId: string, subject: string, token?: string | null): RoomAccessDecision {
    const auth = this.resolveAuthContext(token);
    return this.canCreateRoom(auth, roomId, subject);
  }

  authorizeJoin(
    roomId: string,
    subject: string,
    currentPeerCount: number,
    token?: string | null,
  ): RoomAccessDecision {
    const auth = this.resolveAuthContext(token);
    return this.canJoinRoom(auth, roomId, subject, currentPeerCount);
  }

  authorizeJoinOrThrow(
    roomId: string,
    subject: string,
    currentPeerCount: number,
    token?: string | null,
  ): AuthContext {
    const auth = this.resolveAuthContext(token);
    const decision = this.canJoinRoom(auth, roomId, subject, currentPeerCount);
    if (!decision.allowed) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, decision.reason);
    }
    return auth;
  }

  createEphemeralSubject(prefix?: string): string {
    return this.generator.createEphemeralSubject(prefix);
  }

  hasPermission(auth: AuthContext, permission: Permission): boolean {
    if (!auth.authenticated) {
      return false;
    }
    return auth.permissions.includes(Permissions.ADMIN) || auth.permissions.includes(permission);
  }

  requirePermission(auth: AuthContext, permission: Permission): void {
    if (!this.hasPermission(auth, permission)) {
      throw new AppError(
        ErrorCode.INVALID_MESSAGE,
        `Missing required permission: ${permission}`,
      );
    }
  }

  requireRoomScope(auth: AuthContext, roomId: string): void {
    if (auth.roomId && auth.roomId !== roomId) {
      throw new AppError(
        ErrorCode.INVALID_MESSAGE,
        `Auth context scoped to room ${auth.roomId}, not ${roomId}`,
      );
    }
  }

  getConfig(): Readonly<AuthConfig> {
    return this.config;
  }

  getPolicyConfig(): Readonly<RoomAccessPolicyConfig> {
    return this.policy.getConfig();
  }

  getGenerator(): TokenGenerator {
    return this.generator;
  }

  getValidator(): TokenValidator {
    return this.validator;
  }

  getPolicy(): RoomAccessPolicy {
    return this.policy;
  }
}

export function createAuthService(
  secret: string,
  overrides: Partial<Omit<AuthConfig, "secret">> = {},
): AuthService {
  return new AuthService({
    config: mergeAuthConfig({ secret, ...overrides }),
  });
}

export function createStrictAuthService(secret: string): AuthService {
  return createAuthService(secret, {
    allowAnonymousCreate: false,
    allowAnonymousJoin: false,
  });
}

export type { RoomAccessAction };
