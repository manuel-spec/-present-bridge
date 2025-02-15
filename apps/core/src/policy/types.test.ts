import { describe, expect, it } from "vitest";
import {
  DEFAULT_PEER_LIMITS_CONFIG,
  DEFAULT_POLICY_SERVICE_CONFIG,
  DEFAULT_ROOM_POLICY_CONFIG,
  PolicyViolationCode,
  allowedDecision,
  createRateLimitKey,
  createViolation,
  deniedDecision,
  formatRateLimitKey,
  isReservedRoomName,
  mergePolicyConfig,
  normalizeRoomName,
} from "./types.js";

describe("policy/types", () => {
  it("creates and formats rate limit keys", () => {
    const key = createRateLimitKey("ip", "127.0.0.1");
    expect(formatRateLimitKey(key)).toBe("ip:127.0.0.1");
  });

  it("builds allowed and denied decisions", () => {
    expect(allowedDecision().allowed).toBe(true);
    const denied = deniedDecision(
      createViolation(PolicyViolationCode.ROOM_FULL, "full", { roomId: "room-a" }),
    );
    expect(denied.allowed).toBe(false);
    expect(denied.violation?.code).toBe(PolicyViolationCode.ROOM_FULL);
  });

  it("merges policy config with defaults", () => {
    const config = mergePolicyConfig({
      room: { maxPeersPerRoom: 16 },
    });
    expect(config.room.maxPeersPerRoom).toBe(16);
    expect(config.peer.maxTransportsPerPeer).toBe(DEFAULT_PEER_LIMITS_CONFIG.maxTransportsPerPeer);
  });

  it("normalizes room names and checks reserved names", () => {
    expect(normalizeRoomName("  room-a  ")).toBe("room-a");
    expect(isReservedRoomName("Admin", DEFAULT_ROOM_POLICY_CONFIG.reservedRoomNames)).toBe(true);
  });

  it("exposes default configs", () => {
    expect(DEFAULT_POLICY_SERVICE_CONFIG.globalRateLimit.maxRequests).toBeGreaterThan(0);
    expect(DEFAULT_ROOM_POLICY_CONFIG.maxRoomNameLength).toBe(64);
  });
});
