/**
 * Freemium usage service — device-local quota for AI photo-recipes.
 *
 * 無料枠は**初回の FREE_LIFETIME_LIMIT 回だけ**（既定 1・日次リセットなし。
 * 2026-08-12 に「毎日1回」から変更 — ユーザー判断）。使い切ったら、
 * リワード広告を見るたびに 1 回ぶんのトークンが貯まる。トークンは無期限。
 *
 * **広告視聴の回数に上限は無い**（2026-08-14 に AD_BONUS_DAILY_LIMIT=3 を撤廃 —
 * ユーザー判断「無料でも使い続けられるように」）。1 日 3 本の上限があった頃は、
 * 4 本目を見ようとした無料ユーザーが BYOK 案内しかないペイウォールに飛ばされ、
 * その日は事実上使えなくなっていた。全体のコスト上限はサーバーの global cap
 * (`apps/server/src/lib/rate-limit.ts`) が担保するので、端末側で速度制限をかける
 * 必要はない。Premium (RevenueCat) bypasses the quota. See docs/フリーミアム設計.md.
 *
 * 既存ユーザーへの移行: 日次キーの履歴は数え直さない（生涯カウンタは 0 から）。
 * 更新後に 1 回だけ無料枠が復活するが、害はなく実装が単純。
 */
import { FREE_DAILY_LIMIT_CONFIG } from '../config';
import { isAdRewardAvailable } from './ad-reward.service';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { hasUserApiKey } from './byok.service';
import { isPremium } from './entitlement.service';

/** 無料の AI レシピ作成の**生涯**回数（build-time configurable, default 1）。 */
export const FREE_LIFETIME_LIMIT = FREE_DAILY_LIMIT_CONFIG;

const USAGE_KEY_PREFIX = 'ai_photo_recipe_usage:';
/** 生涯の無料枠消費数。日付キーを持たない = リセットされない。 */
const LIFETIME_FREE_KEY = 'ai_photo_recipe_free_lifetime_used';
const TOKEN_BALANCE_KEY = 'ai_photo_recipe_token_balance';

export interface FreemiumStatus {
  isPremium: boolean;
  /** Unlimited via the user's own Gemini key (BYOK). */
  isByok: boolean;
  /** Successful cloud inferences used today (0 for premium display). */
  used: number;
  /** Effective allowance today (base + banked tokens); Infinity for premium. */
  limit: number;
  /** Remaining uses today; Infinity for premium. */
  remaining: number;
  canInfer: boolean;
  /** Offer a rewarded ad: out of uses and an ad can be shown. No per-day watch cap. */
  canWatchAdForMore: boolean;
  /** Ad-earned tokens banked and not yet spent (persists across days). */
  tokenBalance: number;
}

/** Calendar-day key, e.g. "2026-06-28". */
export function currentDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function remainingFree(used: number, limit: number = FREE_LIFETIME_LIMIT): number {
  return Math.max(0, limit - used);
}

/** Pure mapping from (premium, used, banked tokens, ad state) to gate status. */
export function deriveFreemiumStatus(
  premium: boolean,
  used: number,
  tokenBalance = 0,
  adAvailable = false,
  byok = false,
  baseLimit: number = FREE_LIFETIME_LIMIT,
): FreemiumStatus {
  if (premium || byok) {
    return {
      isPremium: premium,
      isByok: byok && !premium,
      used: 0,
      limit: Number.POSITIVE_INFINITY,
      remaining: Number.POSITIVE_INFINITY,
      canInfer: true,
      canWatchAdForMore: false,
      tokenBalance: 0,
    };
  }
  const balance = Math.max(0, tokenBalance);
  const limit = baseLimit + balance;
  const remaining = Math.max(0, baseLimit - used) + balance;
  return {
    isPremium: false,
    isByok: false,
    used,
    limit,
    remaining,
    canInfer: remaining > 0,
    canWatchAdForMore: adAvailable && remaining === 0,
    tokenBalance: balance,
  };
}

async function readCount(key: string): Promise<number> {
  const raw = await getAppMeta(key);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export async function getDailyUsage(date: Date = new Date()): Promise<number> {
  return readCount(USAGE_KEY_PREFIX + currentDayKey(date));
}

export async function incrementDailyUsage(date: Date = new Date()): Promise<number> {
  const next = (await getDailyUsage(date)) + 1;
  await setAppMeta(USAGE_KEY_PREFIX + currentDayKey(date), String(next));
  return next;
}

/** 生涯の無料枠をいくつ使ったか（リセットされない）。 */
export async function getLifetimeFreeUsed(): Promise<number> {
  return readCount(LIFETIME_FREE_KEY);
}

async function incrementLifetimeFreeUsed(): Promise<void> {
  await setAppMeta(LIFETIME_FREE_KEY, String((await getLifetimeFreeUsed()) + 1));
}

/** Ad-earned tokens banked and not yet spent. Persists indefinitely (no date key). */
export async function getTokenBalance(): Promise<number> {
  return readCount(TOKEN_BALANCE_KEY);
}

async function setTokenBalance(value: number): Promise<void> {
  await setAppMeta(TOKEN_BALANCE_KEY, String(Math.max(0, value)));
}

/**
 * Watch a rewarded ad to earn one banked token (persists indefinitely).
 * **Ungated** — every watch banks a token, however many times a day.
 * Returns the new token balance.
 */
export async function grantAdBonus(): Promise<number> {
  const next = (await getTokenBalance()) + 1;
  await setTokenBalance(next);
  return next;
}

/** Spend one banked token (floors at 0). Returns the new balance. */
export async function spendToken(): Promise<number> {
  const balance = await getTokenBalance();
  if (balance <= 0) return 0;
  const next = balance - 1;
  await setTokenBalance(next);
  return next;
}

/** Combined premium + quota + token status for the gate / UI. */
export async function getFreemiumStatus(): Promise<FreemiumStatus> {
  const [premium, used, tokenBalance, byok] = await Promise.all([
    isPremium(),
    getLifetimeFreeUsed(),
    getTokenBalance(),
    hasUserApiKey(),
  ]);
  return deriveFreemiumStatus(premium, used, tokenBalance, isAdRewardAvailable(), byok);
}

/**
 * Count one successful cloud inference against the quota: spends today's free
 * allowance first, then a banked token if the free allowance is used up.
 * No-op for premium and BYOK users (BYOK uses the user's own key/quota).
 * Call only when the AI (our managed server) actually returned a draft.
 */
export async function recordCloudInference(): Promise<void> {
  if (await isPremium()) return;
  if (await hasUserApiKey()) return;
  const used = await getLifetimeFreeUsed();
  if (used < FREE_LIFETIME_LIMIT) {
    await incrementLifetimeFreeUsed();
  } else {
    await spendToken();
  }
}
