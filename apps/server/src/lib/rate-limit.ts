/**
 * Best-effort in-memory daily rate limiter for the Vision inference endpoint.
 *
 * These are COST / ABUSE guards, NOT the freemium gate. The per-user free
 * quota (1 AI photo-recipe/day) is enforced client-side and premium is
 * validated by RevenueCat — the server has no auth, so it cannot tell premium
 * from free. See docs/フリーミアム設計.md.
 *
 * Two independent caps, both configurable via env and both enforced per 24h:
 *   - INFER_DAILY_LIMIT          per-client (by IP) requests/day   (default 20)
 *   - INFER_GLOBAL_DAILY_LIMIT   total requests/day across clients (default 30)
 *
 * The global cap is the real cost ceiling — it bounds total Gemini calls/day
 * regardless of how many clients hit the endpoint. Set either to 0 to disable.
 *
 * 既定 30 は「月の上限を ¥1,000 以内に収める」方針から逆算した値
 * （1 推論 ≒ ¥1 の実測 × 30 日）。ユーザーが増えたら上げる。
 * 実測コストと上限の考え方は docs/レシピ推論の評価設計.md §9。
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

import { notifyGlobalUsage } from './usage-alert.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export type RateLimitResult = { allowed: true } | { allowed: false; scope: 'client' | 'global' };

/**
 * 用途ごとの独立した上限。**1 本のグローバルカウンタを共有してはいけない。**
 *
 * このサーバーは だいどこ と さいえん手帳 が相乗りしている（さいえん手帳 決定⑨）。
 * 両者は 1 推論あたりの単価が違う:
 *
 * | 用途 | 内容 | 実測の単価 |
 * | --- | --- | --- |
 * | レシピ推論（だいどこ） | 画像 + 材料と手順の長い出力 | **¥0.45** |
 * | AI 相談（さいえん手帳） | 画像 + 診断の構造化出力 | **¥0.35**（思考オフ後） |
 *
 * 単価が違うのに 1 本のカウンタを共有すると、**安い呼び出しが高い呼び出しの枠に
 * 締め出される**。実際 2026-08-19 まで両者が同じ 30 回/日を分け合っており、
 * さいえん手帳が公開されても写真ベースの記録（saien-techo#143）に着手できなかった。
 *
 * 上限はどれも Railway の環境変数で**デプロイ無しに**変えられる。
 */
export interface RateLimitPool {
  /** グローバル計数のキー。プール間で共有しない */
  key: string;
  /** 通知メールの見出しに使う名前 */
  label: string;
  /** グローバル上限の環境変数名 */
  globalEnv: string;
  globalDefault: number;
  /** クライアント別上限の環境変数名 */
  clientEnv: string;
  clientDefault: number;
}

/**
 * だいどこのレシピ系（`/infer/*`・`/resolve/*`）。**既定 30 は据え置く** —
 * 「月の上限を ¥1,000 以内」の方針から逆算した値（¥0.45 × 30 回 × 30 日 ≒ ¥405）。
 */
export const RECIPE_POOL: RateLimitPool = {
  key: '__global__',
  label: 'だいどこ AI利用',
  globalEnv: 'INFER_GLOBAL_DAILY_LIMIT',
  globalDefault: 30,
  clientEnv: 'INFER_DAILY_LIMIT',
  clientDefault: 20,
};

/**
 * さいえん手帳の AI 相談（`/garden/consult`）。
 *
 * 既定 100 は「無料枠 1 回/日 × 100 人が毎日使っても月 ¥1,050 に収まる」
 * （¥0.35 × 100 × 30）。**レシピ側の 30 とは独立**なので、片方が使い切っても
 * もう片方は動く。
 */
export const GARDEN_POOL: RateLimitPool = {
  key: '__global_garden__',
  label: 'さいえん手帳 AI相談',
  globalEnv: 'GARDEN_GLOBAL_DAILY_LIMIT',
  globalDefault: 100,
  clientEnv: 'GARDEN_DAILY_LIMIT',
  clientDefault: 20,
};

/**
 * さいえん手帳の収穫の写真記録（`/garden/harvest`）。
 *
 * **相談とも分ける。** 1 推論が ¥0.07 と相談（¥0.35）の 1/5 で、
 * 頻度は収穫期にほぼ毎日と桁が違う。同じ枠に入れると、
 * **安い呼び出しが高い呼び出しの枠に締め出される**（プールを分けた元の理由と同じ）。
 *
 * 既定 500 は「200 人が毎日 1 枚記録しても収まる」（¥0.07 × 500 × 30 = 月 ¥1,050）。
 * さいえん手帳側は無料枠 1 枚/日 + まとめてリワードなので、
 * 実際の消費はこれより緩やかになる見込み（saien-techo#144）。
 */
export const HARVEST_POOL: RateLimitPool = {
  key: '__global_harvest__',
  label: 'さいえん手帳 収穫記録',
  globalEnv: 'HARVEST_GLOBAL_DAILY_LIMIT',
  globalDefault: 500,
  clientEnv: 'HARVEST_DAILY_LIMIT',
  clientDefault: 60,
};

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
export function checkRateLimit(
  clientId: string,
  pool: RateLimitPool = RECIPE_POOL,
  now = Date.now(),
): RateLimitResult {
  const clientLimit = limitFromEnv(pool.clientEnv, pool.clientDefault);
  const globalLimit = limitFromEnv(pool.globalEnv, pool.globalDefault);

  const globalBucket = currentBucket(pool.key, now);
  if (globalLimit > 0 && globalBucket.count >= globalLimit) {
    return { allowed: false, scope: 'global' };
  }

  // クライアント別カウンタもプールで分ける。同じ IP がレシピと相談を
  // 両方使ったとき、片方の消費でもう片方が止まらないように。
  const clientBucket = currentBucket(`${pool.key}:client:${clientId}`, now);
  if (clientLimit > 0 && clientBucket.count >= clientLimit) {
    return { allowed: false, scope: 'client' };
  }

  globalBucket.count += 1;
  clientBucket.count += 1;
  notifyGlobalUsage(globalBucket.count, globalLimit, globalBucket.resetAt, pool);
  return { allowed: true };
}

/** Test helper: clear all counters. */
export function resetRateLimitForTesting(): void {
  buckets.clear();
}
