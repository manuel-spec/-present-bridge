import { describe, expect, it, vi } from "vitest";
import * as authMiddlewareModule from "./auth-middleware.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ErrorCode } from "@bridge-packet/shared";
import { AppError } from "../lib/errors.js";
import {
  attachAuthToRequest,
  createAuthMiddleware,
  createAuthPreHandler,
  createAuthRouteGuard,
  createOptionalAuthMiddleware,
  createPermissionMiddleware,
  createRequiredAuthMiddleware,
  createRoomJoinAuthMiddleware,
  createRoomScopedAuthMiddleware,
  extractRoomIdFromParams,
  extractTokenFromRequest,
  getRequestAuth,
  hasRequestPermission,
  requireRequestAuth,
  sendForbidden,
} from "./auth-middleware.js";
import { createAuthService } from "./auth-service.js";
import { Permission, createAuthContextFromPayload } from "./types.js";

const SECRET = "middleware-secret-key-16";

function createMockReply(): FastifyReply {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

function createMockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    headers: {},
    query: {},
    params: {},
    ...overrides,
  } as FastifyRequest;
}

describe("auth-middleware", () => {
  const authService = createAuthService(SECRET);

  it("extracts bearer token from authorization header", () => {
    const request = createMockRequest({
      headers: { authorization: "Bearer abc123" },
    });
    expect(extractTokenFromRequest(request)).toBe("abc123");
  });

  it("extracts raw authorization header value", () => {
    const request = createMockRequest({
      headers: { authorization: "raw-token" },
    });
    expect(extractTokenFromRequest(request)).toBe("raw-token");
  });

  it("extracts token from query parameter", () => {
    const request = createMockRequest({
      query: { token: "query-token" },
    });
    expect(extractTokenFromRequest(request)).toBe("query-token");
  });

  it("returns null when no token present", () => {
    expect(extractTokenFromRequest(createMockRequest())).toBeNull();
  });

  it("optional middleware attaches anonymous context", async () => {
    const middleware = createOptionalAuthMiddleware(authService);
    const request = createMockRequest();
    const reply = createMockReply();

    await middleware(request, reply);
    expect(getRequestAuth(request).authenticated).toBe(false);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("required middleware rejects missing token", async () => {
    const middleware = createRequiredAuthMiddleware(authService);
    const request = createMockRequest();
    const reply = createMockReply();

    await middleware(request, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: ErrorCode.INVALID_MESSAGE }),
      }),
    );
  });

  it("authenticates valid token and checks permission", async () => {
    const { token } = authService.issueJoinToken("room-a", "alice");
    const middleware = createAuthMiddleware({
      authService,
      requiredPermission: Permission.JOIN,
    });
    const request = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const reply = createMockReply();

    await middleware(request, reply);
    expect(getRequestAuth(request).authenticated).toBe(true);
    expect(getRequestAuth(request).subject).toBe("alice");
  });

  it("room scoped middleware validates room id param", async () => {
    const { token } = authService.issueJoinToken("room-a", "alice");
    const middleware = createRoomScopedAuthMiddleware(authService);
    const request = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
      params: { roomId: "room-b" },
    });
    const reply = createMockReply();

    await middleware(request, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it("requireRequestAuth throws when unauthenticated", () => {
    const request = createMockRequest();
    expect(() => requireRequestAuth(request)).toThrow(AppError);
  });

  it("attachAuthToRequest sets request auth", () => {
    const request = createMockRequest();
    const auth = createAuthContextFromPayload(
      authService.issueJoinToken("room-a", "alice").payload,
    );
    attachAuthToRequest(request, auth);
    expect(requireRequestAuth(request).subject).toBe("alice");
  });

  it("extracts bearer token from array authorization header", () => {
    const request = createMockRequest({
      headers: { authorization: ["Bearer array-token"] },
    });
    expect(extractTokenFromRequest(request)).toBe("array-token");
  });

  it("extracts raw token from array authorization header", () => {
    const request = createMockRequest({
      headers: { authorization: ["raw-array-token"] },
    });
    expect(extractTokenFromRequest(request)).toBe("raw-array-token");
  });

  it("extracts token from custom header and query param", () => {
    const request = createMockRequest({
      headers: { "x-auth-token": "header-token" },
      query: { access_token: "query-token" },
    });
    expect(
      extractTokenFromRequest(request, { headerName: "x-auth-token", queryParam: "access_token" }),
    ).toBe("header-token");

    const queryOnly = createMockRequest({
      query: { access_token: "query-token" },
    });
    expect(
      extractTokenFromRequest(queryOnly, { headerName: "x-auth-token", queryParam: "access_token" }),
    ).toBe("query-token");
  });

  it("rejects invalid token with unauthorized response", async () => {
    const middleware = createRequiredAuthMiddleware(authService);
    const request = createMockRequest({
      headers: { authorization: "Bearer invalid-token" },
    });
    const reply = createMockReply();

    await middleware(request, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it("rethrows non-app errors during authentication", async () => {
    const brokenService = {
      authenticate: vi.fn(() => {
        throw new Error("unexpected");
      }),
      requireRoomScope: vi.fn(),
      requirePermission: vi.fn(),
    } as unknown as ReturnType<typeof createAuthService>;

    const middleware = createRequiredAuthMiddleware(brokenService);
    await expect(
      middleware(createMockRequest({ headers: { authorization: "Bearer x" } }), createMockReply()),
    ).rejects.toThrow("unexpected");
  });

  it("createAuthPreHandler supports permission overrides", async () => {
    const { token } = authService.issueAdminToken("room-a", "admin");
    const handler = createAuthPreHandler(authService, { requiredPermission: Permission.ADMIN });
    const request = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const reply = createMockReply();

    await handler(request, reply);
    expect(hasRequestPermission(request, Permission.ADMIN)).toBe(true);
  });

  it("createAuthRouteGuard attaches anonymous context when optional", async () => {
    const guard = createAuthRouteGuard({ authService, optional: true });
    const request = createMockRequest();
    const reply = createMockReply();

    await guard(request, reply);
    expect(getRequestAuth(request).authenticated).toBe(false);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("createAuthRouteGuard attaches anonymous when optional middleware leaves auth unset", async () => {
    const noopMiddleware = vi.fn(async () => undefined);
    const spy = vi
      .spyOn(authMiddlewareModule, "createAuthMiddleware")
      .mockReturnValue(noopMiddleware);

    const guard = createAuthRouteGuard({ authService, optional: true, attachOnOptional: true });
    const request = createMockRequest();
    const reply = createMockReply();

    await guard(request, reply);
    expect(getRequestAuth(request).authenticated).toBe(false);
    spy.mockRestore();
  });

  it("createAuthRouteGuard stops when reply already sent", async () => {
    const guard = createAuthRouteGuard({ authService, optional: false });
    const request = createMockRequest();
    const reply = createMockReply();
    (reply as { sent: boolean }).sent = true;

    await guard(request, reply);
    expect(request.auth).toBeUndefined();
  });

  it("createRoomJoinAuthMiddleware allows anonymous join with room scope", async () => {
    const { token } = authService.issueJoinToken("room-a", "alice");
    const middleware = createRoomJoinAuthMiddleware(authService);
    const request = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
      params: { roomId: "room-a" },
    });
    const reply = createMockReply();

    await middleware(request, reply);
    expect(getRequestAuth(request).authenticated).toBe(true);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("extractRoomIdFromParams trims and returns room id", () => {
    const request = createMockRequest({ params: { roomId: "  room-a  " } });
    expect(extractRoomIdFromParams(request)).toBe("room-a");
    expect(extractRoomIdFromParams(createMockRequest())).toBeNull();
  });

  it("hasRequestPermission checks admin and specific permissions", () => {
    const request = createMockRequest();
    expect(hasRequestPermission(request, Permission.JOIN)).toBe(false);

    const { token } = authService.issueJoinToken("room-a", "alice");
    attachAuthToRequest(request, createAuthContextFromPayload(authService.validateTokenOrThrow(token)));
    expect(hasRequestPermission(request, Permission.JOIN)).toBe(true);
    expect(hasRequestPermission(request, Permission.ADMIN)).toBe(false);

    const adminRequest = createMockRequest();
    const adminToken = authService.issueAdminToken("room-a", "admin").token;
    attachAuthToRequest(
      adminRequest,
      createAuthContextFromPayload(authService.validateTokenOrThrow(adminToken)),
    );
    expect(hasRequestPermission(adminRequest, Permission.JOIN)).toBe(true);
  });

  it("sendForbidden returns 403 payload", () => {
    const reply = createMockReply();
    sendForbidden(reply, "Not allowed");
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: ErrorCode.INVALID_MESSAGE }),
      }),
    );
  });

  it("createPermissionMiddleware enforces required permission", async () => {
    const { token } = authService.issueJoinToken("room-a", "alice");
    const middleware = createPermissionMiddleware(authService, Permission.ADMIN);
    const request = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const reply = createMockReply();

    await middleware(request, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });
});
