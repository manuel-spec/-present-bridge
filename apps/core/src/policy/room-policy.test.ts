import { describe, expect, it } from "vitest";
import { ErrorCode } from "@bridge-packet/shared";
import { AppError } from "../lib/errors.js";
import { createRoomPolicy, assertValidRoomName } from "./room-policy.js";
import { PolicyViolationCode } from "./types.js";

describe("RoomPolicy", () => {
  const policy = createRoomPolicy();

  it("validates acceptable room names", () => {
    expect(policy.validateRoomName("room-a").allowed).toBe(true);
    expect(policy.validateRoomName("Room_123").allowed).toBe(true);
  });

  it("rejects empty, long, invalid, and reserved room names", () => {
    expect(policy.validateRoomName("").allowed).toBe(false);
    expect(policy.validateRoomName("a".repeat(65)).allowed).toBe(false);
    expect(policy.validateRoomName("bad name").allowed).toBe(false);
    expect(policy.validateRoomName("admin").allowed).toBe(false);
  });

  it("validateRoomNameOrThrow throws AppError", () => {
    expect(() => policy.validateRoomNameOrThrow("admin")).toThrow(AppError);
    expect(assertValidRoomName("valid-room")).toBe("valid-room");
  });

  it("allows room creation for valid names", () => {
    expect(
      policy.canCreateRoom({
        roomId: "room-a",
        currentPeerCount: 0,
        isNewRoom: true,
      }).allowed,
    ).toBe(true);
  });

  it("enforces max peer capacity on join", () => {
    const decision = policy.canJoinRoom({
      roomId: "room-a",
      currentPeerCount: 32,
      isNewRoom: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.violation?.code).toBe(PolicyViolationCode.ROOM_FULL);
  });

  it("reports remaining slots and capacity state", () => {
    expect(policy.remainingPeerSlots(30)).toBe(2);
    expect(policy.isAtCapacity(32)).toBe(true);
    expect(policy.isAtCapacity(10)).toBe(false);
  });

  it("rejects room names that are too short", () => {
    const strict = createRoomPolicy({ minRoomNameLength: 3 });
    expect(strict.validateRoomName("ab").allowed).toBe(false);
  });

  it("rejects creating existing rooms when empty creation is disabled", () => {
    const strict = createRoomPolicy({ allowEmptyRoomCreation: false });
    expect(
      strict.canCreateRoom({
        roomId: "room-a",
        currentPeerCount: 2,
        isNewRoom: false,
      }).allowed,
    ).toBe(false);
  });

  it("rejects join for invalid room names and exposes config", () => {
    expect(
      policy.canJoinRoom({ roomId: "bad name", currentPeerCount: 0, isNewRoom: false }).allowed,
    ).toBe(false);
    expect(policy.getConfig().maxPeersPerRoom).toBeGreaterThan(0);
  });

  it("throws with INVALID_MESSAGE code for invalid names", () => {
    try {
      policy.validateRoomNameOrThrow("!!!");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.INVALID_MESSAGE);
    }
  });
});
