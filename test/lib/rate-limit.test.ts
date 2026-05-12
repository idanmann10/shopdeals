import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/lib/rate-limit.ts';

describe('RateLimiter', () => {
  it('allows up to capacity in a burst, then throws', () => {
    const rl = new RateLimiter({ capacity: 3, refillPerSecond: 1 });
    rl.consumeOrThrow('client', 'find_x');
    rl.consumeOrThrow('client', 'find_x');
    rl.consumeOrThrow('client', 'find_x');
    expect(() => rl.consumeOrThrow('client', 'find_x')).toThrow(/rate limit/);
  });

  it('refills tokens over time', async () => {
    // 10 tokens/sec refill = one token every 100ms.
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 10 });
    rl.consumeOrThrow('c', 't');
    expect(() => rl.consumeOrThrow('c', 't')).toThrow();
    await new Promise((r) => setTimeout(r, 120));
    rl.consumeOrThrow('c', 't'); // should not throw
  });

  it('tracks buckets per-client independently', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 0.1 });
    rl.consumeOrThrow('a', 't');
    expect(() => rl.consumeOrThrow('a', 't')).toThrow();
    // Different client — still has its own token.
    rl.consumeOrThrow('b', 't');
  });

  it('returns a helpful retry-after hint in the error message', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 0.5 });
    rl.consumeOrThrow('c', 'find_best_deal');
    try {
      rl.consumeOrThrow('c', 'find_best_deal');
      expect.fail('expected throw');
    } catch (err) {
      expect((err as Error).message).toMatch(/find_best_deal/);
      expect((err as Error).message).toMatch(/retry in \d+s/);
    }
  });
});
