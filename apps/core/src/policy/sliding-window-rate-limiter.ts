import {
  type RateLimitConfig,
  type RateLimitKey,
  type RateLimitResult,
  formatRateLimitKey,
} from "./types.js";

interface WindowEntry {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    if (config.windowMs <= 0) {
      throw new Error("windowMs must be positive");
    }
    if (config.maxRequests <= 0) {
      throw new Error("maxRequests must be positive");
    }
    this.config = config;
  }

  check(key: RateLimitKey, now = Date.now()): RateLimitResult {
    const bucketKey = formatRateLimitKey(key);
    const entry = this.windows.get(bucketKey) ?? { timestamps: [] };
    const windowStart = now - this.config.windowMs;

    entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > windowStart);

    if (entry.timestamps.length >= this.config.maxRequests) {
      const oldest = entry.timestamps[0] ?? now;
      const resetAt = oldest + this.config.windowMs;
      this.windows.set(bucketKey, entry);

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, resetAt - now),
      };
    }

    entry.timestamps.push(now);
    this.windows.set(bucketKey, entry);

    const remaining = Math.max(0, this.config.maxRequests - entry.timestamps.length);
    const resetAt = (entry.timestamps[0] ?? now) + this.config.windowMs;

    return {
      allowed: true,
      remaining,
      resetAt,
    };
  }

  consume(key: RateLimitKey, now = Date.now()): RateLimitResult {
    return this.check(key, now);
  }

  peek(key: RateLimitKey, now = Date.now()): RateLimitResult {
    const bucketKey = formatRateLimitKey(key);
    const entry = this.windows.get(bucketKey) ?? { timestamps: [] };
    const windowStart = now - this.config.windowMs;
    const active = entry.timestamps.filter((timestamp) => timestamp > windowStart);
    const remaining = Math.max(0, this.config.maxRequests - active.length);
    const resetAt = (active[0] ?? now) + this.config.windowMs;

    if (active.length >= this.config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, resetAt - now),
      };
    }

    return {
      allowed: true,
      remaining,
      resetAt,
    };
  }

  reset(key: RateLimitKey): void {
    this.windows.delete(formatRateLimitKey(key));
  }

  resetAll(): void {
    this.windows.clear();
  }

  size(): number {
    return this.windows.size;
  }

  getConfig(): Readonly<RateLimitConfig> {
    return this.config;
  }

  prune(now = Date.now()): number {
    const windowStart = now - this.config.windowMs;
    let removed = 0;

    for (const [key, entry] of this.windows.entries()) {
      entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > windowStart);
      if (entry.timestamps.length === 0) {
        this.windows.delete(key);
        removed += 1;
      }
    }

    return removed;
  }
}

export function createSlidingWindowRateLimiter(config: RateLimitConfig): SlidingWindowRateLimiter {
  return new SlidingWindowRateLimiter(config);
}

export class MultiRateLimiter {
  private readonly limiters = new Map<string, SlidingWindowRateLimiter>();

  register(namespace: string, config: RateLimitConfig): SlidingWindowRateLimiter {
    const limiter = new SlidingWindowRateLimiter(config);
    this.limiters.set(namespace, limiter);
    return limiter;
  }

  check(namespace: string, identifier: string, now = Date.now()): RateLimitResult {
    const limiter = this.limiters.get(namespace);
    if (!limiter) {
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetAt: now };
    }
    return limiter.check({ namespace, identifier }, now);
  }

  reset(namespace: string, identifier: string): void {
    this.limiters.get(namespace)?.reset({ namespace, identifier });
  }

  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.resetAll();
    }
  }

  getLimiter(namespace: string): SlidingWindowRateLimiter | undefined {
    return this.limiters.get(namespace);
  }
}

export function createMultiRateLimiter(
  configs: Record<string, RateLimitConfig>,
): MultiRateLimiter {
  const multi = new MultiRateLimiter();
  for (const [namespace, config] of Object.entries(configs)) {
    multi.register(namespace, config);
  }
  return multi;
}
