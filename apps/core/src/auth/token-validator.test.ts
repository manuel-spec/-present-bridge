import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import { createTokenGenerator } from "./token-generator.js";
import { TokenValidator, createTokenValidator } from "./token-validator.js";
import { Permission, TokenInvalidReason, isTokenValidationFailure } from "./types.js";

const SECRET = "validator-secret-key-16";

describe("TokenValidator", () => {
  let validator: TokenValidator;
  let generator: ReturnType<typeof createTokenGenerator>;

  beforeEach(() => {
    generator = createTokenGenerator(SECRET);
    validator = createTokenValidator(SECRET);
  });

  it("validates well-formed tokens", () => {
    const { token } = generator.issueJoinToken("room-a", "alice", 3600);
    const outcome = validator.validate(token);
    expect(outcome.valid).toBe(true);
    if (outcome.valid) {
      expect(outcome.payload.roomId).toBe("room-a");
    }
  });

  it("rejects empty and malformed tokens", () => {
    expect(validator.validate("").valid).toBe(false);
    expect(validator.validate("bad.token").valid).toBe(false);
  });

  it("rejects tampered signatures", () => {
    const { token } = generator.issueJoinToken("room-a", "alice");
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.invalidsignature000000000000000000`;
    const outcome = validator.validate(tampered);
    expect(outcome.valid).toBe(false);
    if (isTokenValidationFailure(outcome)) {
      expect(outcome.reason).toBe(TokenInvalidReason.INVALID_SIGNATURE);
    }
  });

  it("rejects expired tokens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));

    const { token, payload } = generator.issueJoinToken("room-a", "alice", 60);
    vi.setSystemTime(new Date("2020-01-01T00:02:00Z"));

    const outcome = validator.validate(token);
    expect(outcome.valid).toBe(false);
    if (isTokenValidationFailure(outcome)) {
      expect(outcome.reason).toBe(TokenInvalidReason.EXPIRED);
    }

    expect(validator.isExpired(payload)).toBe(true);
    vi.useRealTimers();
  });

  it("rejects not-yet-valid tokens", () => {
    const payload = {
      roomId: "room-a",
      subject: "alice",
      permissions: [Permission.JOIN] as const,
      issuedAt: Math.floor(Date.now() / 1000) + 3600,
      expiresAt: Math.floor(Date.now() / 1000) + 7200,
      issuer: "packet-bridge",
    };
    const token = generator.encodeToken(payload, generator.signPayload(payload));
    const outcome = validator.validate(token);
    expect(outcome.valid).toBe(false);
    if (isTokenValidationFailure(outcome)) {
      expect(outcome.reason).toBe(TokenInvalidReason.NOT_YET_VALID);
    }
  });

  it("validateOrThrow throws AppError on failure", () => {
    expect(() => validator.validateOrThrow("invalid")).toThrow(AppError);
    try {
      validator.validateOrThrow("invalid");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.INVALID_MESSAGE);
    }
  });

  it("validates room scope and permissions", () => {
    const { token } = generator.issueJoinToken("room-a", "alice");
    expect(validator.validateForRoom(token, "room-a").valid).toBe(true);
    expect(validator.validateForRoom(token, "room-b").valid).toBe(false);
    expect(validator.validatePermission(token, Permission.JOIN).valid).toBe(true);
    expect(validator.validatePermission(token, Permission.ADMIN).valid).toBe(false);
    expect(
      validator.validateForRoomAndPermission(token, "room-a", Permission.JOIN).valid,
    ).toBe(true);
  });

  it("builds auth context from valid token", () => {
    const { token } = generator.issueJoinToken("room-a", "alice");
    const context = validator.toAuthContext(token);
    expect(context?.authenticated).toBe(true);
    expect(context?.subject).toBe("alice");
    expect(validator.toAuthContext("bad")).toBeNull();
  });

  it("reports remaining TTL", () => {
    const { payload } = generator.issueJoinToken("room-a", "alice", 120);
    expect(validator.remainingTtlSeconds(payload)).toBeGreaterThan(0);
    expect(validator.remainingTtlSeconds({ ...payload, expiresAt: 0 })).toBe(0);
  });

  it("rejects tokens with invalid payload fields", () => {
    const base = generator.issueJoinToken("room-a", "alice").payload;
    const emptyRoom = generator.encodeToken(
      { ...base, roomId: "   " },
      generator.signPayload({ ...base, roomId: "   " }),
    );
    expect(validator.validate(emptyRoom).valid).toBe(false);

    const emptySubject = generator.encodeToken(
      { ...base, subject: "" },
      generator.signPayload({ ...base, subject: "" }),
    );
    expect(validator.validate(emptySubject).valid).toBe(false);

    const noPermissions = generator.encodeToken(
      { ...base, permissions: [] },
      generator.signPayload({ ...base, permissions: [] }),
    );
    expect(validator.validate(noPermissions).valid).toBe(false);
  });

  it("rejects tokens with issuer mismatch", () => {
    const base = generator.issueJoinToken("room-a", "alice").payload;
    const wrongIssuer = generator.encodeToken(
      { ...base, issuer: "other-issuer" },
      generator.signPayload({ ...base, issuer: "other-issuer" }),
    );
    expect(validator.validate(wrongIssuer).valid).toBe(false);
  });

  it("propagates validation failures for room and permission checks", () => {
    expect(validator.validateForRoom("bad", "room-a").valid).toBe(false);
    expect(validator.validatePermission("bad", Permission.JOIN).valid).toBe(false);
    expect(
      validator.validateForRoomAndPermission("bad", "room-a", Permission.JOIN).valid,
    ).toBe(false);

    const { token } = generator.issueJoinToken("room-a", "alice");
    expect(validator.validateForRoomAndPermission(token, "room-b", Permission.JOIN).valid).toBe(
      false,
    );
  });

  it("exposes validator config and assertValidToken helper", async () => {
    const { assertValidToken } = await import("./token-validator.js");
    const { token } = generator.issueJoinToken("room-a", "alice");
    expect(assertValidToken(token, SECRET).roomId).toBe("room-a");
    expect(validator.getConfig().secret).toBe(SECRET);
  });
});
