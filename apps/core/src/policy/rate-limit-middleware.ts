import type { FastifyReply, FastifyRequest } from "fastify";
import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import type { PolicyService } from "./policy-service.js";
import type { RateLimitMiddlewareOptions } from "./types.js";
import { createRateLimitKey } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    rateLimit?: {
      remaining: number;
      resetAt: number;
    };
  }
}

const DEFAULT_NAMESPACE = "ip";

export function defaultRateLimitKey(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return request.ip;
}

export function createRateLimitMiddleware(
  policyService: PolicyService,
  options: RateLimitMiddlewareOptions = {},
) {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const keyFromRequest = options.keyFromRequest ?? defaultRateLimitKey;
  const skip = options.skip ?? (() => false);

  return async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (skip(request)) {
      return;
    }

    const identifier = keyFromRequest(request);
    const result = policyService.checkRateLimit(createRateLimitKey(namespace, identifier));

    reply.header("x-ratelimit-remaining", String(result.remaining));
    reply.header("x-ratelimit-reset", String(result.resetAt));

    request.rateLimit = {
      remaining: result.remaining,
      resetAt: result.resetAt,
    };

    if (!result.allowed) {
      if (result.retryAfterMs !== undefined) {
        reply.header("retry-after", String(Math.ceil(result.retryAfterMs / 1000)));
      }
      const error = new AppError(ErrorCode.INVALID_MESSAGE, "Rate limit exceeded");
      reply.code(429).send({ error: error.toPayload() });
    }
  };
}

export function createGlobalRateLimitMiddleware(policyService: PolicyService) {
  return createRateLimitMiddleware(policyService, {
    namespace: "global",
    keyFromRequest: () => "global",
  });
}

export function createIpRateLimitMiddleware(policyService: PolicyService) {
  return createRateLimitMiddleware(policyService, {
    namespace: "ip",
    keyFromRequest: defaultRateLimitKey,
  });
}

export function getRequestRateLimit(request: FastifyRequest): { remaining: number; resetAt: number } | undefined {
  return request.rateLimit;
}

export function createCombinedRateLimitMiddleware(policyService: PolicyService) {
  const globalMiddleware = createGlobalRateLimitMiddleware(policyService);
  const ipMiddleware = createIpRateLimitMiddleware(policyService);

  return async function combinedRateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    await globalMiddleware(request, reply);
    if (reply.sent) {
      return;
    }
    await ipMiddleware(request, reply);
  };
}
