/**
 * In-memory per-client rate limiter for expensive tools.
 *
 * Why this exists: SerpApi credits cost real money. A looping agent (or a
 * misbehaving one) can torch our monthly budget in minutes by re-calling
 * `find_best_deal` / `find_products` thousands of times. This module
 * enforces a token-bucket limit per clientHash so one misbehaving agent
 * can't take out the whole service.
 *
 * Implementation choices:
 *   - In-memory: state is per-process, which is fine for a single-replica
 *     Hono server. If we scale horizontally we'd swap for Redis with the
 *     same interface.
 *   - Token bucket (not fixed window): smooth out bursts; an agent that
 *     legitimately wants 5 queries in 10 seconds isn't blocked, but a
 *     hot-loop after that will be.
 *   - Throws an `McpError` with `InvalidRequest` (-32600) when over limit.
 *     The agent sees a clean "you've made too many requests" message and
 *     can back off rather than the protocol going to a transport error.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export interface RateLimitConfig {
  /** Max tokens (= max queries) the bucket can hold. */
  capacity: number;
  /** Tokens refilled per second. capacity / refillPerSecond ≈ how long a
   * cold start of `capacity` queries takes to fully replenish. */
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: RateLimitConfig) {}

  /**
   * Consume one token for `key`. Throws an `McpError` when the bucket is
   * empty. Use this at the top of expensive tool handlers.
   */
  consumeOrThrow(key: string, toolName: string): void {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.config.capacity, lastRefillMs: now };
      this.buckets.set(key, bucket);
    } else {
      // Refill since last touch.
      const elapsedSec = (now - bucket.lastRefillMs) / 1000;
      const refilled = elapsedSec * this.config.refillPerSecond;
      bucket.tokens = Math.min(this.config.capacity, bucket.tokens + refilled);
      bucket.lastRefillMs = now;
    }
    if (bucket.tokens < 1) {
      const waitSec = Math.ceil((1 - bucket.tokens) / this.config.refillPerSecond);
      throw new McpError(
        ErrorCode.InvalidRequest,
        `rate limit: ${toolName} allows ${this.config.capacity} request(s) every ${Math.round(
          this.config.capacity / this.config.refillPerSecond,
        )}s — retry in ${waitSec}s`,
      );
    }
    bucket.tokens -= 1;
  }

  /** Test-only — wipe the buckets. */
  reset(): void {
    this.buckets.clear();
  }
}

/**
 * Shared instance for tools that hit paid upstreams (SerpApi).
 *
 * Defaults: 20 requests, refilled at 0.5/sec (1 token every 2s).
 * That's an effective rate of 1,800 requests/hour per client, or a burst
 * of 20 immediately followed by a slower sustained 1/2sec. For SerpApi at
 * 2 credits per call, that's 3,600 credits/hour per client — bounded.
 */
export const serpApiRateLimiter = new RateLimiter({
  capacity: 20,
  refillPerSecond: 0.5,
});
