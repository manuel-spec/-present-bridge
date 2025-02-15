import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import {
  type PolicyDecision,
  type RoomPolicyConfig,
  type RoomPolicyContext,
  PolicyViolationCode,
  DEFAULT_ROOM_POLICY_CONFIG,
  allowedDecision,
  createViolation,
  deniedDecision,
  isReservedRoomName,
  normalizeRoomName,
} from "./types.js";

export class RoomPolicy {
  private readonly config: RoomPolicyConfig;

  constructor(config: Partial<RoomPolicyConfig> = {}) {
    this.config = {
      ...DEFAULT_ROOM_POLICY_CONFIG,
      ...config,
      reservedRoomNames: config.reservedRoomNames ?? DEFAULT_ROOM_POLICY_CONFIG.reservedRoomNames,
    };
  }

  validateRoomName(roomName: string): PolicyDecision {
    const normalized = normalizeRoomName(roomName);

    if (normalized.length < this.config.minRoomNameLength) {
      return deniedDecision(
        createViolation(
          PolicyViolationCode.ROOM_NAME_INVALID,
          "Room name is too short",
          { minLength: this.config.minRoomNameLength },
        ),
      );
    }

    if (normalized.length > this.config.maxRoomNameLength) {
      return deniedDecision(
        createViolation(
          PolicyViolationCode.ROOM_NAME_INVALID,
          "Room name is too long",
          { maxLength: this.config.maxRoomNameLength },
        ),
      );
    }

    if (!this.config.roomNamePattern.test(normalized)) {
      return deniedDecision(
        createViolation(
          PolicyViolationCode.ROOM_NAME_INVALID,
          "Room name contains invalid characters",
          { pattern: this.config.roomNamePattern.source },
        ),
      );
    }

    if (isReservedRoomName(normalized, this.config.reservedRoomNames)) {
      return deniedDecision(
        createViolation(
          PolicyViolationCode.ROOM_NAME_INVALID,
          "Room name is reserved",
          { roomName: normalized },
        ),
      );
    }

    return allowedDecision();
  }

  validateRoomNameOrThrow(roomName: string): string {
    const decision = this.validateRoomName(roomName);
    if (!decision.allowed && decision.violation) {
      throw new AppError(ErrorCode.INVALID_MESSAGE, decision.violation.message);
    }
    return normalizeRoomName(roomName);
  }

  canCreateRoom(context: RoomPolicyContext): PolicyDecision {
    const nameDecision = this.validateRoomName(context.roomId);
    if (!nameDecision.allowed) {
      return nameDecision;
    }

    if (!this.config.allowEmptyRoomCreation && !context.isNewRoom && context.currentPeerCount > 0) {
      return deniedDecision(
        createViolation(
          PolicyViolationCode.ROOM_NAME_INVALID,
          "Room already exists",
          { roomId: context.roomId },
        ),
      );
    }

    return allowedDecision();
  }

  canJoinRoom(context: RoomPolicyContext): PolicyDecision {
    const nameDecision = this.validateRoomName(context.roomId);
    if (!nameDecision.allowed) {
      return nameDecision;
    }

    if (context.currentPeerCount >= this.config.maxPeersPerRoom) {
      return deniedDecision(
        createViolation(
          PolicyViolationCode.ROOM_FULL,
          `Room has reached maximum capacity of ${this.config.maxPeersPerRoom} peers`,
          {
            roomId: context.roomId,
            currentPeerCount: context.currentPeerCount,
            maxPeers: this.config.maxPeersPerRoom,
          },
        ),
      );
    }

    return allowedDecision();
  }

  remainingPeerSlots(currentPeerCount: number): number {
    return Math.max(0, this.config.maxPeersPerRoom - currentPeerCount);
  }

  isAtCapacity(currentPeerCount: number): boolean {
    return currentPeerCount >= this.config.maxPeersPerRoom;
  }

  getConfig(): Readonly<RoomPolicyConfig> {
    return this.config;
  }
}

export function createRoomPolicy(config?: Partial<RoomPolicyConfig>): RoomPolicy {
  return new RoomPolicy(config);
}

export function assertValidRoomName(roomName: string, config?: Partial<RoomPolicyConfig>): string {
  return createRoomPolicy(config).validateRoomNameOrThrow(roomName);
}
