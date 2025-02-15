import type { FastifyReply, FastifyRequest } from "fastify";
import { ErrorCode } from "@packet-bridge/shared";
import { AppError, isAppError } from "../lib/errors.js";
import {
  type AuthContext,
  ANONYMOUS_AUTH_CONTEXT,
  AUTH_BEARER_PREFIX,
  AUTH_TOKEN_HEADER,
  AUTH_TOKEN_QUERY_PARAM,
  Permission,
} from "./types.js";
import type { AuthService } from "./auth-service.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export interface AuthMiddlewareOptions {
  readonly authService: AuthService;
  readonly optional?: boolean;
  readonly roomIdParam?: string;
  readonly requiredPermission?: import("./types.js").Permission;
  readonly tokenHeader?: string;
  readonly tokenQueryParam?: string;
}

export interface ExtractTokenOptions {
  readonly headerName?: string;
  readonly queryParam?: string;
}

export function extractTokenFromRequest(
  request: FastifyRequest,
  options: ExtractTokenOptions = {},
): string | null {
  const headerName = (options.headerName ?? AUTH_TOKEN_HEADER).toLowerCase();
  const queryParam = options.queryParam ?? AUTH_TOKEN_QUERY_PARAM;

  const headerValue = request.headers[headerName];
  if (typeof headerValue === "string" && headerValue.length > 0) {
    if (headerValue.startsWith(AUTH_BEARER_PREFIX)) {
      return headerValue.slice(AUTH_BEARER_PREFIX.length).trim();
    }
    return headerValue.trim();
  }

  if (Array.isArray(headerValue) && headerValue[0]) {
    const first = headerValue[0];
    if (first.startsWith(AUTH_BEARER_PREFIX)) {
      return first.slice(AUTH_BEARER_PREFIX.length).trim();
    }
    return first.trim();
  }

  const query = request.query as Record<string, unknown> | undefined;
  const queryToken = query?.[queryParam];
  if (typeof queryToken === "string" && queryToken.length > 0) {
    return queryToken.trim();
  }

  return null;
}

export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const {
    authService,
    optional = false,
    roomIdParam,
    requiredPermission,
    tokenHeader,
    tokenQueryParam,
  } = options;

  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = extractTokenFromRequest(request, {
      headerName: tokenHeader,
      queryParam: tokenQueryParam,
    });

    if (!token) {
      if (optional) {
        request.auth = ANONYMOUS_AUTH_CONTEXT;
        return;
      }
      return sendUnauthorized(reply, "Missing authentication token");
    }

    try {
      const auth = authService.authenticate(token);
      request.auth = auth;

      if (roomIdParam) {
        const params = request.params as Record<string, string> | undefined;
        const roomId = params?.[roomIdParam];
        if (roomId) {
          authService.requireRoomScope(auth, roomId);
        }
      }

      if (requiredPermission) {
        authService.requirePermission(auth, requiredPermission);
      }
    } catch (error) {
      if (isAppError(error)) {
        return sendUnauthorized(reply, error.message);
      }
      throw error;
    }
  };
}

export function createOptionalAuthMiddleware(authService: AuthService) {
  return createAuthMiddleware({ authService, optional: true });
}

export function createRequiredAuthMiddleware(authService: AuthService) {
  return createAuthMiddleware({ authService, optional: false });
}

export function createRoomScopedAuthMiddleware(
  authService: AuthService,
  roomIdParam = "roomId",
) {
  return createAuthMiddleware({
    authService,
    optional: false,
    roomIdParam,
  });
}

function sendUnauthorized(reply: FastifyReply, message: string): void {
  const error = new AppError(ErrorCode.INVALID_MESSAGE, message);
  reply.code(401).send({ error: error.toPayload() });
}

export function getRequestAuth(request: FastifyRequest): AuthContext {
  return request.auth ?? ANONYMOUS_AUTH_CONTEXT;
}

export function requireRequestAuth(request: FastifyRequest): AuthContext {
  const auth = getRequestAuth(request);
  if (!auth.authenticated) {
    throw new AppError(ErrorCode.INVALID_MESSAGE, "Authentication required");
  }
  return auth;
}

export function attachAuthToRequest(request: FastifyRequest, auth: AuthContext): void {
  request.auth = auth;
}

export function createAuthPreHandler(
  authService: AuthService,
  overrides: Partial<Omit<AuthMiddlewareOptions, "authService">> = {},
) {
  return createAuthMiddleware({
    authService,
    ...overrides,
  });
}

export interface AuthRouteGuardOptions extends AuthMiddlewareOptions {
  readonly attachOnOptional?: boolean;
}

export function createAuthRouteGuard(options: AuthRouteGuardOptions) {
  const { attachOnOptional = true, ...middlewareOptions } = options;
  const middleware = createAuthMiddleware(middlewareOptions);

  return async function authRouteGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    await middleware(request, reply);
    if (reply.sent) {
      return;
    }

    if (middlewareOptions.optional && attachOnOptional && !request.auth) {
      request.auth = ANONYMOUS_AUTH_CONTEXT;
    }
  };
}

export function extractRoomIdFromParams(
  request: FastifyRequest,
  paramName = "roomId",
): string | null {
  const params = request.params as Record<string, string> | undefined;
  const roomId = params?.[paramName];
  return roomId?.trim() || null;
}

export function createRoomJoinAuthMiddleware(
  authService: AuthService,
  roomIdParam = "roomId",
) {
  return createAuthMiddleware({
    authService,
    optional: true,
    roomIdParam,
  });
}

export function hasRequestPermission(
  request: FastifyRequest,
  permission: Permission,
): boolean {
  const auth = getRequestAuth(request);
  if (!auth.authenticated) {
    return false;
  }
  return auth.permissions.includes(Permission.ADMIN) || auth.permissions.includes(permission);
}

export function sendForbidden(reply: FastifyReply, message: string): void {
  const error = new AppError(ErrorCode.INVALID_MESSAGE, message);
  reply.code(403).send({ error: error.toPayload() });
}

export function createPermissionMiddleware(
  authService: AuthService,
  permission: Permission,
) {
  return createAuthMiddleware({
    authService,
    optional: false,
    requiredPermission: permission,
  });
}
