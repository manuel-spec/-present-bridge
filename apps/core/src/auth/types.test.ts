import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_AUTH_CONTEXT,
  DEFAULT_AUTH_CONFIG,
  Permission,
  PERMISSION_HIERARCHY,
  TokenInvalidReason,
  createAuthContextFromPayload,
  hasAllPermissions,
  hasPermission,
  isPermission,
  isTokenValidationFailure,
  maxPermission,
  mergeAuthConfig,
  normalizePermissions,
  permissionRank,
} from "./types.js";

describe("auth/types", () => {
  it("identifies valid permissions", () => {
    expect(isPermission("join")).toBe(true);
    expect(isPermission("admin")).toBe(true);
    expect(isPermission("invalid")).toBe(false);
  });

  it("normalizes and deduplicates permissions", () => {
    expect(normalizePermissions(["join", "join", "admin", "bogus"])).toEqual([
      "join",
      "admin",
    ]);
  });

  it("evaluates permission hierarchy with admin override", () => {
    expect(hasPermission(["admin"], Permission.JOIN)).toBe(true);
    expect(hasPermission(["join"], Permission.ADMIN)).toBe(false);
    expect(hasAllPermissions(["admin"], [Permission.JOIN, Permission.CREATE])).toBe(true);
  });

  it("ranks permissions and selects max", () => {
    expect(permissionRank(Permission.JOIN)).toBeLessThan(permissionRank(Permission.ADMIN));
    expect(maxPermission([Permission.JOIN, Permission.ADMIN])).toBe(Permission.ADMIN);
    expect(maxPermission([])).toBeNull();
  });

  it("creates auth context from payload", () => {
    const payload = {
      roomId: "room-a",
      subject: "alice",
      permissions: [Permission.JOIN] as const,
      issuedAt: 1,
      expiresAt: 2,
    };
    const context = createAuthContextFromPayload(payload);
    expect(context.authenticated).toBe(true);
    expect(context.subject).toBe("alice");
    expect(context.roomId).toBe("room-a");
  });

  it("detects token validation failures", () => {
    expect(
      isTokenValidationFailure({
        valid: false,
        reason: TokenInvalidReason.EXPIRED,
        message: "expired",
      }),
    ).toBe(true);
    expect(
      isTokenValidationFailure({
        valid: true,
        payload: {
          roomId: "r",
          subject: "s",
          permissions: [Permission.JOIN],
          issuedAt: 1,
          expiresAt: 2,
        },
      }),
    ).toBe(false);
  });

  it("merges auth config with defaults", () => {
    const config = mergeAuthConfig({ secret: "super-secret-key-1234" });
    expect(config.defaultTtlSeconds).toBe(DEFAULT_AUTH_CONFIG.defaultTtlSeconds);
    expect(config.secret).toBe("super-secret-key-1234");
  });

  it("exposes anonymous auth context", () => {
    expect(ANONYMOUS_AUTH_CONTEXT.authenticated).toBe(false);
    expect(ANONYMOUS_AUTH_CONTEXT.permissions).toEqual([]);
  });

  it("lists permission hierarchy in order", () => {
    expect(PERMISSION_HIERARCHY[0]).toBe(Permission.JOIN);
    expect(PERMISSION_HIERARCHY.at(-1)).toBe(Permission.ADMIN);
  });
});
