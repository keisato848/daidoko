/**
 * Best-effort in-memory daily rate limiter for the Vision inference endpoint.
 *
 * These are COST / ABUSE guards, NOT the freemium gate. The per-user free
 * quota (3 AI photo-recipes/month) is enforced client-side and premium is
 * validated by RevenueCat — the server has no auth, so it cannot tell premium
 * from free. See docs/フリーミアム設計.md.
 *
 * Two independent caps, both configurable via env and both enforced per 24h:
 *   - INFER_DAILY_LIMIT          per-client (by IP) requests/day   (default 20)
 *   - INFER_GLOBAL_DAILY_LIMIT   total requests/day across clients (default 200)
 *
 * The global cap is the real cost ceiling — it bounds total Gemini calls/day
 * regardless of how many clients hit the endpoint. Set either to 0 to disable.
 *
 * Note: INFER_DAILY_LIMIT is coarse anti-abuse only. Because premium users are
 * "unlimited" but indistinguishable here, keep it generous (or 0) so it does
 * not block a paying household sharing one IP; rely on the GLOBAL cap (+ the
 * Gemini quota) for cost. A real per-user cap would need accounts + a shared
 * store (DynamoDB) — see infra/README.md follow-ups.
 *
 * Not durable across restarts and not shared across instances — sufficient as a
 * cost guardrail for a single Railway instance. Replace with a shared store if
 * the deployment scales horizontally.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;
const GLOBAL_KEY = '__global__';

export type RateLimitResult = { allowed: true } | { allowed: false; scope: 'client' | 'global' };

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function limitFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Returns the live bucket for a key, resetting it if the window has elapsed.
function currentBucket(key: string, now: number): Bucket {
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    const fresh: Bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, fresh);
    return fresh;
  }
  return existing;
}

/**
 * Returns whether the request is allowed and, if not, which cap was hit.
 * Increments both the global and per-client counters only when allowed.
 */
export function checkRateLimit(clientId: string, now = Date.now()): RateLimitResult {
  const clientLimit = limitFromEnv('INFER_DAILY_LIMIT', 20);
  const globalLimit = limitFromEnv('INFER_GLOBAL_DAILY_LIMIT', 200);

  const globalBucket = currentBucket(GLOBAL_KEY, now);
  if (globalLimit > 0 && globalBucket.count >= globalLimit) {
    return { allowed: false, scope: 'global' };
  }

  const clientBucket = currentBucket(`client:${clientId}`, now);
  if (clientLimit > 0 && clientBucket.count >= clientLimit) {
    return { allowed: false, scope: 'client' };
  }

  globalBucket.count += 1;
  clientBucket.count += 1;
  return { allowed: true };
}

/** Test helper: clear all counters. */
export function resetRateLimitForTesting(): void {
  buckets.clear();
}
