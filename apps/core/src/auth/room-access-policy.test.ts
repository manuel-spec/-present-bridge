import { describe, expect, it } from "vitest";
import { ErrorCode } from "@bridge-packet/shared";
import { AppError } from "../lib/errors.js";
import { createRoomAccessPolicy } from "./room-access-policy.js";
import {
  ANONYMOUS_AUTH_CONTEXT,
  Permission,
  RoomAccessAction,
  createAuthContextFromPayload,
} from "./types.js";
import { createTokenGenerator } from "./token-generator.js";

const SECRET = "room-access-secret-16";

describe("RoomAccessPolicy", () => {
  const policy = createRoomAccessPolicy(SECRET);

  it("allows anonymous create and join by default", () => {
    expect(policy.canCreateRoom(ANONYMOUS_AUTH_CONTEXT, "room-a", "alice").allowed).toBe(true);
    expect(policy.canJoinRoom(ANONYMOUS_AUTH_CONTEXT, "room-a", "alice", 0).allowed).toBe(true);
  });

  it("rejects invalid room ids", () => {
    expect(policy.validateRoomId("").allowed).toBe(false);
    expect(policy.validateRoomId("bad room!").allowed).toBe(false);
    expect(policy.validateRoomId("valid-room_1").allowed).toBe(true);
  });

  it("rejects blocked subjects", () => {
    const strict = createRoomAccessPolicy(SECRET, {
      blockedSubjects: new Set(["blocked-user"]),
    });
    expect(strict.validateSubject("blocked-user").allowed).toBe(false);
    expect(strict.validateSubject("alice").allowed).toBe(true);
  });

  it("enforces room capacity on join", () => {
    const decision = policy.canJoinRoom(ANONYMOUS_AUTH_CONTEXT, "room-a", "alice", 32);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("capacity");
  });

  it("requires token when configured", () => {
    const strict = createRoomAccessPolicy(SECRET, {
      requireTokenForJoin: true,
      requireTokenForCreate: true,
    });
    expect(strict.canJoinRoom(ANONYMOUS_AUTH_CONTEXT, "room-a", "alice").allowed).toBe(false);
    expect(strict.canCreateRoom(ANONYMOUS_AUTH_CONTEXT, "room-a", "alice").allowed).toBe(false);
  });

  it("validates token room scope and permissions", () => {
    const generator = createTokenGenerator(SECRET);
    const { payload } = generator.issueJoinToken("room-a", "alice");
    const auth = createAuthContextFromPayload(payload);

    expect(policy.canJoinRoom(auth, "room-a", "alice").allowed).toBe(true);
    expect(policy.canJoinRoom(auth, "room-b", "alice").allowed).toBe(false);
    expect(policy.canAdminRoom(auth, "room-a", "alice").allowed).toBe(false);

    const adminPayload = generator.issueAdminToken("room-a", "alice").payload;
    const adminAuth = createAuthContextFromPayload(adminPayload);
    expect(policy.canAdminRoom(adminAuth, "room-a", "alice").allowed).toBe(true);
  });

  it("evaluateOrThrow throws on denial", () => {
    expect(() =>
      policy.evaluateOrThrow({
        action: RoomAccessAction.JOIN,
        roomId: "",
        subject: "alice",
        auth: ANONYMOUS_AUTH_CONTEXT,
        currentPeerCount: 0,
      }),
    ).toThrow(AppError);

    try {
      policy.evaluateOrThrow({
        action: RoomAccessAction.JOIN,
        roomId: "",
        subject: "alice",
        auth: ANONYMOUS_AUTH_CONTEXT,
      });
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.INVALID_MESSAGE);
    }
  });

  it("denies anonymous access when disabled in auth config", () => {
    const strict = createRoomAccessPolicy(SECRET, {
      allowAnonymousJoin: false,
      allowAnonymousCreate: false,
    });
    const join = strict.evaluate({
      action: RoomAccessAction.JOIN,
      roomId: "room-a",
      subject: "alice",
      auth: ANONYMOUS_AUTH_CONTEXT,
    });
    expect(join.allowed).toBe(false);
    expect(join.requiredPermission).toBe(Permission.JOIN);

    const create = strict.evaluate({
      action: RoomAccessAction.CREATE,
      roomId: "room-a",
      subject: "alice",
      auth: ANONYMOUS_AUTH_CONTEXT,
    });
    expect(create.allowed).toBe(false);
    expect(create.requiredPermission).toBe(Permission.CREATE);
  });

  it("short-circuits evaluate when subject is invalid", () => {
    const decision = policy.evaluate({
      action: RoomAccessAction.JOIN,
      roomId: "room-a",
      subject: "",
      auth: ANONYMOUS_AUTH_CONTEXT,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("Subject");
  });

  it("rejects invalid subjects", () => {
    expect(policy.validateSubject("").allowed).toBe(false);
    expect(policy.validateSubject("x".repeat(129)).allowed).toBe(false);
  });

  it("rejects room ids that are too long", () => {
    expect(policy.validateRoomId("a".repeat(65)).allowed).toBe(false);
  });

  it("rejects authenticated create without create permission", () => {
    const generator = createTokenGenerator(SECRET);
    const auth = createAuthContextFromPayload(generator.issueJoinToken("room-a", "alice").payload);
    const decision = policy.canCreateRoom(auth, "room-a", "alice");
    expect(decision.allowed).toBe(false);
    expect(decision.requiredPermission).toBe(Permission.CREATE);
  });

  it("rejects authenticated create scoped to another room", () => {
    const generator = createTokenGenerator(SECRET);
    const auth = createAuthContextFromPayload(
      generator.issueCreateToken("room-a", "alice").payload,
    );
    expect(policy.canCreateRoom(auth, "room-b", "alice").allowed).toBe(false);
  });

  it("rejects authenticated join without join permission", () => {
    const generator = createTokenGenerator(SECRET);
    const auth = createAuthContextFromPayload(
      generator.issueToken({
        roomId: "room-a",
        subject: "alice",
        permissions: [Permission.CREATE],
      }).payload,
    );
    const decision = policy.canJoinRoom(auth, "room-a", "alice");
    expect(decision.allowed).toBe(false);
    expect(decision.requiredPermission).toBe(Permission.JOIN);
  });

  it("rejects authenticated join scoped to another room", () => {
    const generator = createTokenGenerator(SECRET);
    const auth = createAuthContextFromPayload(generator.issueJoinToken("room-a", "alice").payload);
    expect(policy.canJoinRoom(auth, "room-b", "alice").allowed).toBe(false);
  });

  it("evaluates admin access requirements", () => {
    expect(
      policy.evaluate({
        action: RoomAccessAction.ADMIN,
        roomId: "room-a",
        subject: "alice",
        auth: ANONYMOUS_AUTH_CONTEXT,
      }).allowed,
    ).toBe(false);

    const generator = createTokenGenerator(SECRET);
    const joinAuth = createAuthContextFromPayload(generator.issueJoinToken("room-a", "alice").payload);
    expect(
      policy.evaluate({
        action: RoomAccessAction.ADMIN,
        roomId: "room-a",
        subject: "alice",
        auth: joinAuth,
      }).allowed,
    ).toBe(false);

    const adminAuth = createAuthContextFromPayload(
      generator.issueAdminToken("room-a", "alice").payload,
    );
    expect(policy.canAdminRoom(adminAuth, "room-b", "alice").allowed).toBe(false);
    expect(policy.canAdminRoom(adminAuth, "room-a", "alice").allowed).toBe(true);
  });

  it("rejects unknown access actions", () => {
    const decision = policy.evaluate({
      action: "unknown" as RoomAccessAction,
      roomId: "room-a",
      subject: "alice",
      auth: ANONYMOUS_AUTH_CONTEXT,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("Unknown access action");
  });

  it("exposes policy configuration", () => {
    expect(policy.getConfig().maxPeersPerRoom).toBe(32);
  });
});
