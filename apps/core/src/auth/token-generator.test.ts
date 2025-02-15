import { describe, expect, it } from "vitest";
import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import {
  TokenGenerator,
  createTokenGenerator,
  decodeTokenPayload,
  parseTokenString,
} from "./token-generator.js";
import { Permission } from "./types.js";

const SECRET = "test-secret-key-min-16";

describe("TokenGenerator", () => {
  const generator = createTokenGenerator(SECRET);

  it("issues join tokens with expected payload", () => {
    const signed = generator.issueJoinToken("room-a", "alice", 3600);
    expect(signed.payload.roomId).toBe("room-a");
    expect(signed.payload.subject).toBe("alice");
    expect(signed.payload.permissions).toContain(Permission.JOIN);
    expect(signed.token.split(".")).toHaveLength(3);
  });

  it("issues create and admin tokens with elevated permissions", () => {
    const createToken = generator.issueCreateToken("room-b", "bob");
    expect(createToken.payload.permissions).toContain(Permission.CREATE);
    expect(createToken.payload.permissions).toContain(Permission.ADMIN);

    const adminToken = generator.issueAdminToken("room-c", "carol");
    expect(adminToken.payload.permissions).toContain(Permission.ADMIN);
    expect(adminToken.payload.permissions).toContain(Permission.MODERATE);
  });

  it("rejects tokens missing subject in payload validation", () => {
    expect(() =>
      generator.issueToken({
        roomId: "room-a",
        subject: "   ",
        permissions: [Permission.JOIN],
      }),
    ).toThrow(AppError);
  });

  it("rejects invalid issuance options", () => {
    expect(() =>
      generator.issueToken({
        roomId: "",
        subject: "alice",
        permissions: [Permission.JOIN],
      }),
    ).toThrow(AppError);

    expect(() =>
      generator.issueToken({
        roomId: "room-a",
        subject: "alice",
        permissions: [],
      }),
    ).toThrow(AppError);

    expect(() =>
      generator.issueToken({
        roomId: "room-a",
        subject: "alice",
        permissions: [Permission.JOIN],
        ttlSeconds: 0,
      }),
    ).toThrow(AppError);
  });

  it("rejects short secrets at construction", () => {
    expect(() => new TokenGenerator({ config: { secret: "short" } as never })).toThrow(AppError);
  });

  it("produces verifiable signatures", () => {
    const signed = generator.issueJoinToken("room-a", "alice");
    const expected = generator.signPayload(signed.payload);
    expect(generator.compareSignatures(expected, signed.signature)).toBe(true);
    expect(generator.compareSignatures(expected, "invalid")).toBe(false);
  });

  it("rejects payloads with non-increasing expiry", () => {
    const assertValidPayload = (
      generator as unknown as { assertValidPayload(payload: unknown): void }
    ).assertValidPayload.bind(generator);

    expect(() =>
      assertValidPayload({
        roomId: "room-a",
        subject: "alice",
        permissions: [Permission.JOIN],
        issuedAt: 200,
        expiresAt: 200,
        issuer: "test",
      }),
    ).toThrow(AppError);
  });

  it("serializes and decodes token payloads", () => {
    const signed = generator.issueJoinToken("room-a", "alice", 60);
    const { encodedPayload } = parseTokenString(signed.token);
    const decoded = decodeTokenPayload(encodedPayload);
    expect(decoded.roomId).toBe("room-a");
    expect(decoded.subject).toBe("alice");
  });

  it("rejects malformed token strings", () => {
    expect(() => parseTokenString("bad-token")).toThrow(AppError);
    expect(() => decodeTokenPayload("not-json")).toThrow();
  });

  it("creates ephemeral subjects", () => {
    const a = generator.createEphemeralSubject();
    const b = generator.createEphemeralSubject("guest");
    expect(a).toMatch(/^peer-/);
    expect(b).toMatch(/^guest-/);
    expect(a).not.toBe(b);
  });

  it("rotates secret via new generator instance", () => {
    const rotated = generator.rotateSecret("another-secret-key-16");
    expect(rotated.getConfig().secret).toBe("another-secret-key-16");
  });

  it("rejects tokens exceeding maximum ttl", () => {
    expect(() =>
      generator.issueToken({
        roomId: "room-a",
        subject: "alice",
        permissions: [Permission.JOIN],
        ttlSeconds: 86400 * 8,
      }),
    ).toThrow(AppError);
  });

  it("rejects malformed token version segments", () => {
    expect(() => parseTokenString("0.payload.sig")).toThrow(AppError);
  });

  it("throws AppError with INVALID_MESSAGE for bad payload version", () => {
    const encoded = Buffer.from(JSON.stringify({ v: 99, roomId: "x", subject: "y", iat: 1, exp: 2, permissions: ["join"] }), "utf8").toString("base64url");
    try {
      decodeTokenPayload(encoded);
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.INVALID_MESSAGE);
    }
  });
});
