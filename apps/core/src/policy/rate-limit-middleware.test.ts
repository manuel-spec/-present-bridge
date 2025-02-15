import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ErrorCode } from "@packet-bridge/shared";
import {
  createCombinedRateLimitMiddleware,
  createGlobalRateLimitMiddleware,
  createIpRateLimitMiddleware,
  createRateLimitMiddleware,
  defaultRateLimitKey,
  getRequestRateLimit,
} from "./rate-limit-middleware.js";
import { createPolicyService } from "./policy-service.js";

function createMockReply(): FastifyReply {
  const reply = {
    header: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    sent: false,
  };
  return reply as unknown as FastifyReply;
}

function createMockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    ip: "127.0.0.1",
    headers: {},
    ...overrides,
  } as FastifyRequest;
}

describe("rate-limit-middleware", () => {
  const policyService = createPolicyService({
    globalRateLimit: { windowMs: 60_000, maxRequests: 1 },
    perIpRateLimit: { windowMs: 60_000, maxRequests: 1 },
  });

  beforeEach(() => {
    policyService.resetRateLimits();
  });

  it("extracts client key from x-forwarded-for", () => {
    const request = createMockRequest({
      headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2" },
    });
    expect(defaultRateLimitKey(request)).toBe("10.0.0.1");
  });

  it("uses default namespace and key extractor", async () => {
    const middleware = createRateLimitMiddleware(policyService);
    const reply = createMockReply();
    await middleware(createMockRequest({ ip: "10.1.2.3" }), reply);
    expect(reply.header).toHaveBeenCalledWith("x-ratelimit-remaining", "0");
  });

  it("falls back to request ip", () => {
    expect(defaultRateLimitKey(createMockRequest({ ip: "192.168.1.5" }))).toBe("192.168.1.5");
  });

  it("allows requests under limit and sets headers", async () => {
    const middleware = createIpRateLimitMiddleware(policyService);
    const request = createMockRequest();
    const reply = createMockReply();

    await middleware(request, reply);
    expect(reply.header).toHaveBeenCalledWith("x-ratelimit-remaining", "0");
    expect(reply.code).not.toHaveBeenCalled();
    expect(getRequestRateLimit(request)?.remaining).toBe(0);
  });

  it("returns 429 when rate limit exceeded", async () => {
    const middleware = createIpRateLimitMiddleware(policyService);
    const request = createMockRequest();
    const reply = createMockReply();

    await middleware(request, reply);
    await middleware(request, createMockReply());

    const blockedReply = createMockReply();
    await middleware(request, blockedReply);
    expect(blockedReply.code).toHaveBeenCalledWith(429);
    expect(blockedReply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: ErrorCode.INVALID_MESSAGE }),
      }),
    );
    expect(blockedReply.header).toHaveBeenCalledWith("retry-after", expect.any(String));
  });

  it("supports custom namespace and skip predicate", async () => {
    const middleware = createRateLimitMiddleware(policyService, {
      namespace: "global",
      keyFromRequest: () => "shared-key",
      skip: (request) => request.headers["x-bypass"] === "true",
    });

    const bypassRequest = createMockRequest({ headers: { "x-bypass": "true" } });
    const reply = createMockReply();
    await middleware(bypassRequest, reply);
    expect(reply.header).not.toHaveBeenCalled();
  });

  it("global middleware uses shared global bucket", async () => {
    const middleware = createGlobalRateLimitMiddleware(policyService);
    const reply = createMockReply();
    await middleware(createMockRequest(), reply);
    expect(reply.header).toHaveBeenCalledWith("x-ratelimit-remaining", "0");
  });

  it("combined middleware skips ip limit when global already rejected", async () => {
    const service = createPolicyService({
      globalRateLimit: { windowMs: 60_000, maxRequests: 1 },
      perIpRateLimit: { windowMs: 60_000, maxRequests: 1 },
    });
    const middleware = createCombinedRateLimitMiddleware(service);
    const request = createMockRequest();

    function createSentTrackingReply(): FastifyReply {
      let sent = false;
      const reply = {
        header: vi.fn().mockReturnThis(),
        code: vi.fn().mockImplementation(() => {
          sent = true;
          return reply;
        }),
        send: vi.fn().mockReturnThis(),
        get sent() {
          return sent;
        },
      };
      return reply as unknown as FastifyReply;
    }

    await middleware(request, createSentTrackingReply());
    const blocked = createSentTrackingReply();
    await middleware(request, blocked);
    expect(blocked.code).toHaveBeenCalledWith(429);
  });

  it("combined middleware stops after first rejection", async () => {
    const middleware = createCombinedRateLimitMiddleware(policyService);
    const request = createMockRequest();

    await middleware(request, createMockReply());
    const reply = createMockReply();
    await middleware(request, reply);

    expect(reply.code).toHaveBeenCalledWith(429);
  });
});
