import { describe, expect, it } from "vitest";
import {
  SlidingWindowRateLimiter,
  MultiRateLimiter,
  createMultiRateLimiter,
  createSlidingWindowRateLimiter,
} from "./sliding-window-rate-limiter.js";

describe("SlidingWindowRateLimiter", () => {
  it("allows requests within limit", () => {
    const limiter = createSlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 3 });
    const key = { namespace: "test", identifier: "user-1" };
    const now = 1_000_000;

    expect(limiter.check(key, now).allowed).toBe(true);
    expect(limiter.check(key, now + 1).allowed).toBe(true);
    expect(limiter.check(key, now + 2).allowed).toBe(true);
    expect(limiter.check(key, now + 3).allowed).toBe(false);
  });

  it("resets window after elapsed time", () => {
    const limiter = createSlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const key = { namespace: "test", identifier: "user-1" };

    expect(limiter.consume(key, 0).allowed).toBe(true);
    expect(limiter.consume(key, 100).allowed).toBe(false);
    expect(limiter.consume(key, 2000).allowed).toBe(true);
  });

  it("peek does not consume quota", () => {
    const limiter = createSlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const key = { namespace: "test", identifier: "user-1" };

    limiter.consume(key, 0);
    expect(limiter.peek(key, 0).allowed).toBe(false);
    expect(limiter.peek(key, 2000).allowed).toBe(true);
  });

  it("reset clears bucket state", () => {
    const limiter = createSlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const key = { namespace: "test", identifier: "user-1" };
    limiter.consume(key, 0);
    limiter.reset(key);
    expect(limiter.consume(key, 0).allowed).toBe(true);
  });

  it("prunes stale entries", () => {
    const limiter = createSlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 5 });
    const key = { namespace: "test", identifier: "user-1" };
    limiter.consume(key, 0);
    expect(limiter.size()).toBe(1);
    expect(limiter.prune(5000)).toBe(1);
    expect(limiter.size()).toBe(0);
  });

  it("rejects invalid config", () => {
    expect(() => new SlidingWindowRateLimiter({ windowMs: 0, maxRequests: 1 })).toThrow();
    expect(() => new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 0 })).toThrow();
  });
});

describe("MultiRateLimiter", () => {
  it("routes checks to registered limiters", () => {
    const multi = createMultiRateLimiter({
      ip: { windowMs: 1000, maxRequests: 1 },
    });

    expect(multi.check("ip", "127.0.0.1", 0).allowed).toBe(true);
    expect(multi.check("ip", "127.0.0.1", 1).allowed).toBe(false);
    expect(multi.check("unknown", "id", 0).allowed).toBe(true);
  });

  it("resets individual and all buckets", () => {
    const multi = new MultiRateLimiter();
    multi.register("test", { windowMs: 1000, maxRequests: 1 });
    multi.check("test", "a", 0);
    multi.reset("test", "a");
    expect(multi.check("test", "a", 0).allowed).toBe(true);

    multi.check("test", "b", 0);
    multi.resetAll();
    expect(multi.getLimiter("test")?.size()).toBe(0);
  });
});
