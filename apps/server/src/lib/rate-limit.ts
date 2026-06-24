/**
 * Best-effort in-memory daily rate limiter for the Vision inference endpoint.
 *
 * Not durable across restarts and not shared across instances — sufficient as a
 * cost guardrail for a single Railway instance. Replace with a shared store if
 * the deployment scales horizontally.
 */

const DEFAULT_DAILY_LIMIT = Number(process.env['INFER_DAILY_LIMIT'] ?? 20);
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Returns true if the request is allowed; increments the client's counter. */
export function checkRateLimit(clientId: string, now = Date.now()): boolean {
  const limit = DEFAULT_DAILY_LIMIT;
  if (limit <= 0) return true; // disabled

  const bucket = buckets.get(clientId);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(clientId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Test helper: clear all counters. */
export function resetRateLimitForTesting(): void {
  buckets.clear();
}
