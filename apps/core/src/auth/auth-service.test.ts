import { describe, expect, it } from "vitest";
import { ErrorCode } from "@bridge-packet/shared";
import { AppError } from "../lib/errors.js";
import { createAuthService, createStrictAuthService } from "./auth-service.js";
import { ANONYMOUS_AUTH_CONTEXT, Permission, RoomAccessAction } from "./types.js";

const SECRET = "auth-service-secret-16";

describe("AuthService", () => {
  const service = createAuthService(SECRET);

  it("issues and validates tokens", () => {
    const signed = service.issueJoinToken("room-a", "alice");
    const payload = service.validateTokenOrThrow(signed.token);
    expect(payload.roomId).toBe("room-a");
    expect(service.validateToken("bad").valid).toBe(false);
  });

  it("resolves anonymous context without token", () => {
    expect(service.resolveAuthContext(null)).toEqual(ANONYMOUS_AUTH_CONTEXT);
    expect(service.resolveAuthContext(undefined)).toEqual(ANONYMOUS_AUTH_CONTEXT);
  });

  it("authenticates valid tokens", () => {
    const { token } = service.issueAdminToken("room-a", "admin-user");
    const auth = service.authenticate(token);
    expect(auth.authenticated).toBe(true);
    expect(auth.permissions).toContain(Permission.ADMIN);
  });

  it("authorizes room create and join", () => {
    expect(service.authorizeCreate("room-a", "alice").allowed).toBe(true);
    expect(service.authorizeJoin("room-a", "alice", 0).allowed).toBe(true);
    expect(service.authorizeJoin("room-a", "alice", 100).allowed).toBe(false);
  });

  it("authorizeJoinOrThrow throws when denied", () => {
    expect(() => service.authorizeJoinOrThrow("room-a", "alice", 100)).toThrow(AppError);
  });

  it("denies permissions for unauthenticated contexts", () => {
    expect(service.hasPermission(ANONYMOUS_AUTH_CONTEXT, Permission.JOIN)).toBe(false);
  });

  it("checks permissions and room scope", () => {
    const { token } = service.issueJoinToken("room-a", "alice");
    const auth = service.authenticate(token);
    expect(service.hasPermission(auth, Permission.JOIN)).toBe(true);
    expect(service.hasPermission(auth, Permission.ADMIN)).toBe(false);
    service.requirePermission(auth, Permission.JOIN);
    expect(() => service.requirePermission(auth, Permission.ADMIN)).toThrow(AppError);
    service.requireRoomScope(auth, "room-a");
    expect(() => service.requireRoomScope(auth, "room-b")).toThrow(AppError);
  });

  it("exposes internal components", () => {
    expect(service.getGenerator()).toBeTruthy();
    expect(service.getValidator()).toBeTruthy();
    expect(service.getPolicy()).toBeTruthy();
    expect(service.getConfig().secret).toBe(SECRET);
  });

  it("creates strict service with anonymous access disabled", () => {
    const strict = createStrictAuthService(SECRET);
    expect(strict.authorizeCreate("room-a", "alice").allowed).toBe(false);
    expect(strict.authorizeJoin("room-a", "alice", 0).allowed).toBe(false);
  });

  it("creates ephemeral subjects", () => {
    expect(service.createEphemeralSubject()).toMatch(/^peer-/);
  });

  it("evaluates admin and policy helpers", () => {
    const { token } = service.issueAdminToken("room-a", "admin-user");
    const auth = service.authenticate(token);
    expect(service.canAdminRoom(auth, "room-a", "admin-user").allowed).toBe(true);
    expect(
      service.evaluateAccess({
        action: RoomAccessAction.ADMIN,
        roomId: "room-a",
        subject: "admin-user",
        auth,
      }).allowed,
    ).toBe(true);
    expect(service.getPolicyConfig().maxPeersPerRoom).toBe(32);
  });

  it("assertAccess throws for invalid room id", () => {
    expect(() =>
      service.assertAccess({
        action: "join",
        roomId: "",
        subject: "alice",
        auth: ANONYMOUS_AUTH_CONTEXT,
      }),
    ).toThrow(AppError);

    try {
      service.assertAccess({
        action: "join",
        roomId: "",
        subject: "alice",
        auth: ANONYMOUS_AUTH_CONTEXT,
      });
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.INVALID_MESSAGE);
    }
  });
});
