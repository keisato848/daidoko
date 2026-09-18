import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, resetRateLimitForTesting, RECIPE_POOL } from '../rate-limit.js';

describe('rate-limit', () => {
  beforeEach(() => {
    resetRateLimitForTesting();
    // Use smaller limits for testing by setting env
    process.env[RECIPE_POOL.globalEnv] = '10';
    process.env[RECIPE_POOL.clientEnv] = '5';
  });

  it('allows consuming multiple items with count > 1', () => {
    const now = Date.now();

    // Consume 2 out of 5
    const res1 = checkRateLimit('clientA', RECIPE_POOL, now, 2);
    expect(res1.allowed).toBe(true);

    // Consume 2 more out of 5 (total 4)
    const res2 = checkRateLimit('clientA', RECIPE_POOL, now, 2);
    expect(res2.allowed).toBe(true);

    // Attempt to consume 2 more out of 5 (total 6 > 5) -> should be rejected
    const res3 = checkRateLimit('clientA', RECIPE_POOL, now, 2);
    expect(res3.allowed).toBe(false);
    if (!res3.allowed) {
      expect(res3.scope).toBe('client');
    }

    // Attempt to consume 1 more out of 5 (total 5 = 5) -> should be allowed
    const res4 = checkRateLimit('clientA', RECIPE_POOL, now, 1);
    expect(res4.allowed).toBe(true);
  });
});
