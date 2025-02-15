import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import {
  type AuthConfig,
  type AuthContext,
  type RoomAccessDecision,
  type RoomAccessRequest,
  Permission,
  RoomAccessAction,
  hasPermission,
  mergeAuthConfig,
} from "./types.js";

export interface RoomAccessPolicyConfig {
  readonly auth: AuthConfig;
  readonly maxPeersPerRoom: number;
  readonly requireTokenForJoin: boolean;
  readonly requireTokenForCreate: boolean;
  readonly allowedRoomIdPattern: RegExp;
  readonly blockedSubjects: ReadonlySet<string>;
}

export const DEFAULT_ROOM_ACCESS_POLICY: Omit<RoomAccessPolicyConfig, "auth"> = {
  maxPeersPerRoom: 32,
  requireTokenForJoin: false,
  requireTokenForCreate: false,
  allowedRoomIdPattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/,
  blockedSubjects: new Set<string>(),
};

export interface RoomAccessPolicyOptions {
  readonly config: RoomAccessPolicyConfig;
}

export class RoomAccessPolicy {
  private readonly config: RoomAccessPolicyConfig;

  constructor(options: RoomAccessPolicyOptions) {
    this.config = {
      ...DEFAULT_ROOM_ACCESS_POLICY,
      ...options.config,
      blockedSubjects: new Set(options.config.blockedSubjects),
    };
  }

  evaluate(request: RoomAccessRequest): RoomAccessDecision {
    const roomIdCheck = this.validateRoomId(request.roomId);
    if (!roomIdCheck.allowed) {
      return roomIdCheck;
    }

    const subjectCheck = this.validateSubject(request.subject);
    if (!subjectCheck.allowed) {
      return subjectCheck;
    }

    switch (request.action) {
      case RoomAccessAction.CREATE:
        return this.evaluateCreate(request);
      case RoomAccessAction.JOIN:
        return this.evaluateJoin(request);
      case RoomAccessAction.ADMIN:
        return this.evaluateAdmin(request);
      default:
        return {
          allowed: false,
          reason: `Unknown access action: ${String(request.action)}`,
        };
    }
  }

  evaluateOrThrow(request: RoomAccessRequest): void {
    const decision = this.evaluate(request);
    if (!decision.allowed) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, decision.reason);
    }
  }

  canCreateRoom(auth: AuthContext, roomId: string, subject: string): RoomAccessDecision {
    return this.evaluate({
      action: RoomAccessAction.CREATE,
      roomId,
      subject,
      auth,
    });
  }

  canJoinRoom(
    auth: AuthContext,
    roomId: string,
    subject: string,
    currentPeerCount = 0,
  ): RoomAccessDecision {
    return this.evaluate({
      action: RoomAccessAction.JOIN,
      roomId,
      subject,
      auth,
      currentPeerCount,
    });
  }

  canAdminRoom(auth: AuthContext, roomId: string, subject: string): RoomAccessDecision {
    return this.evaluate({
      action: RoomAccessAction.ADMIN,
      roomId,
      subject,
      auth,
    });
  }

  validateRoomId(roomId: string): RoomAccessDecision {
    const trimmed = roomId.trim();
    if (!trimmed) {
      return { allowed: false, reason: "Room ID cannot be empty" };
    }

    if (trimmed.length > 64) {
      return { allowed: false, reason: "Room ID exceeds maximum length of 64 characters" };
    }

    if (!this.config.allowedRoomIdPattern.test(trimmed)) {
      return {
        allowed: false,
        reason: "Room ID contains invalid characters or format",
      };
    }

    return { allowed: true, reason: "Room ID is valid" };
  }

  validateSubject(subject: string): RoomAccessDecision {
    const trimmed = subject.trim();
    if (!trimmed) {
      return { allowed: false, reason: "Subject cannot be empty" };
    }

    if (trimmed.length > 128) {
      return { allowed: false, reason: "Subject exceeds maximum length of 128 characters" };
    }

    if (this.config.blockedSubjects.has(trimmed.toLowerCase())) {
      return { allowed: false, reason: "Subject is blocked" };
    }

    return { allowed: true, reason: "Subject is valid" };
  }

  getConfig(): Readonly<RoomAccessPolicyConfig> {
    return this.config;
  }

  private evaluateCreate(request: RoomAccessRequest): RoomAccessDecision {
    if (this.config.requireTokenForCreate && !request.auth.authenticated) {
      return {
        allowed: false,
        reason: "Authentication required to create rooms",
        requiredPermission: Permission.CREATE,
      };
    }

    if (request.auth.authenticated) {
      if (request.auth.roomId && request.auth.roomId !== request.roomId) {
        return {
          allowed: false,
          reason: "Token is scoped to a different room",
        };
      }

      if (!hasPermission(request.auth.permissions, Permission.CREATE)) {
        return {
          allowed: false,
          reason: "Insufficient permissions to create room",
          requiredPermission: Permission.CREATE,
        };
      }
    } else if (!this.config.auth.allowAnonymousCreate) {
      return {
        allowed: false,
        reason: "Anonymous room creation is disabled",
        requiredPermission: Permission.CREATE,
      };
    }

    return { allowed: true, reason: "Room creation permitted" };
  }

  private evaluateJoin(request: RoomAccessRequest): RoomAccessDecision {
    const peerCount = request.currentPeerCount ?? 0;

    if (peerCount >= this.config.maxPeersPerRoom) {
      return {
        allowed: false,
        reason: `Room is at capacity (${this.config.maxPeersPerRoom} peers)`,
      };
    }

    if (this.config.requireTokenForJoin && !request.auth.authenticated) {
      return {
        allowed: false,
        reason: "Authentication required to join rooms",
        requiredPermission: Permission.JOIN,
      };
    }

    if (request.auth.authenticated) {
      if (request.auth.roomId && request.auth.roomId !== request.roomId) {
        return {
          allowed: false,
          reason: "Token is scoped to a different room",
        };
      }

      if (!hasPermission(request.auth.permissions, Permission.JOIN)) {
        return {
          allowed: false,
          reason: "Insufficient permissions to join room",
          requiredPermission: Permission.JOIN,
        };
      }
    } else if (!this.config.auth.allowAnonymousJoin) {
      return {
        allowed: false,
        reason: "Anonymous room join is disabled",
        requiredPermission: Permission.JOIN,
      };
    }

    return { allowed: true, reason: "Room join permitted" };
  }

  private evaluateAdmin(request: RoomAccessRequest): RoomAccessDecision {
    if (!request.auth.authenticated) {
      return {
        allowed: false,
        reason: "Authentication required for admin actions",
        requiredPermission: Permission.ADMIN,
      };
    }

    if (request.auth.roomId && request.auth.roomId !== request.roomId) {
      return {
        allowed: false,
        reason: "Token is scoped to a different room",
      };
    }

    if (!hasPermission(request.auth.permissions, Permission.ADMIN)) {
      return {
        allowed: false,
        reason: "Insufficient permissions for admin action",
        requiredPermission: Permission.ADMIN,
      };
    }

    return { allowed: true, reason: "Admin action permitted" };
  }
}

export function createRoomAccessPolicy(
  secret: string,
  overrides: Partial<Omit<RoomAccessPolicyConfig, "auth">> & Partial<Omit<AuthConfig, "secret">> = {},
): RoomAccessPolicy {
  const { maxPeersPerRoom, requireTokenForJoin, requireTokenForCreate, allowedRoomIdPattern, blockedSubjects, ...authOverrides } =
    overrides;

  const auth = mergeAuthConfig({ secret, ...authOverrides });

  return new RoomAccessPolicy({
    config: {
      auth,
      maxPeersPerRoom: maxPeersPerRoom ?? DEFAULT_ROOM_ACCESS_POLICY.maxPeersPerRoom,
      requireTokenForJoin: requireTokenForJoin ?? DEFAULT_ROOM_ACCESS_POLICY.requireTokenForJoin,
      requireTokenForCreate: requireTokenForCreate ?? DEFAULT_ROOM_ACCESS_POLICY.requireTokenForCreate,
      allowedRoomIdPattern: allowedRoomIdPattern ?? DEFAULT_ROOM_ACCESS_POLICY.allowedRoomIdPattern,
      blockedSubjects: blockedSubjects ?? DEFAULT_ROOM_ACCESS_POLICY.blockedSubjects,
    },
  });
}
