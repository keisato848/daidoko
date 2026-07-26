/**
 * Freemium usage service — device-local daily quota for AI photo-recipes.
 *
 * Free tier = FREE_DAILY_LIMIT successful cloud inferences per calendar day,
 * counted in app_meta (key per YYYY-MM-DD, auto-resets daily). A free user who
 * is out of uses can watch a rewarded ad to earn a token — tokens are banked
 * indefinitely (no expiry) in a persistent balance and spent whenever the free
 * daily quota runs out. Watching ads to earn tokens is still capped at
 * AD_BONUS_DAILY_LIMIT per day (an earn-rate limiter, not a use-it-today rule).
 * Premium (RevenueCat) bypasses the quota. The server's global cap remains the
 * real cost ceiling. See docs/フリーミアム設計.md.
 */
import { FREE_DAILY_LIMIT_CONFIG } from '../config';
import { isAdRewardAvailable } from './ad-reward.service';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { hasUserApiKey } from './byok.service';
import { isPremium } from './entitlement.service';

/** Free AI photo-recipes allowed per calendar day (build-time configurable, default 1). */
export const FREE_DAILY_LIMIT = FREE_DAILY_LIMIT_CONFIG;
/** Max rewarded-ad watches (token grants) per day. Earn-rate limiter only — banked tokens never expire. */
export const AD_BONUS_DAILY_LIMIT = 3;

const USAGE_KEY_PREFIX = 'ai_photo_recipe_usage:';
const AD_WATCH_KEY_PREFIX = 'ai_photo_recipe_ad_watch:';
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
  /** Offer a rewarded ad: out of uses, ads available, today's watch cap not reached. */
  canWatchAdForMore: boolean;
  /** Ad-earned tokens banked and not yet spent (persists across days). */
  tokenBalance: number;
  /** Max ad watches (token grants) allowed per day. */
  adWatchLimit: number;
}

/** Calendar-day key, e.g. "2026-06-28". */
export function currentDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function remainingFree(used: number, limit: number = FREE_DAILY_LIMIT): number {
  return Math.max(0, limit - used);
}

/** Pure mapping from (premium, used, banked tokens, ad state) to gate status. */
export function deriveFreemiumStatus(
  premium: boolean,
  used: number,
  tokenBalance = 0,
  adAvailable = false,
  byok = false,
  baseLimit: number = FREE_DAILY_LIMIT,
  bonusLimit: number = AD_BONUS_DAILY_LIMIT,
  adWatchedToday = 0,
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
      adWatchLimit: bonusLimit,
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
    canWatchAdForMore: adAvailable && remaining === 0 && adWatchedToday < bonusLimit,
    tokenBalance: balance,
    adWatchLimit: bonusLimit,
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

/** How many rewarded ads have been watched today (earn-rate gate; resets daily). */
export async function getAdWatchedToday(date: Date = new Date()): Promise<number> {
  return readCount(AD_WATCH_KEY_PREFIX + currentDayKey(date));
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
 * Gated only by today's watch count vs AD_BONUS_DAILY_LIMIT — once that cap is
 * hit, further calls are no-ops until the next calendar day. Returns the new
 * (or unchanged, if capped) token balance.
 */
export async function grantAdBonus(date: Date = new Date()): Promise<number> {
  const watchedToday = await getAdWatchedToday(date);
  const balance = await getTokenBalance();
  if (watchedToday >= AD_BONUS_DAILY_LIMIT) return balance;
  await setAppMeta(AD_WATCH_KEY_PREFIX + currentDayKey(date), String(watchedToday + 1));
  const next = balance + 1;
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
  const [premium, used, tokenBalance, adWatchedToday, byok] = await Promise.all([
    isPremium(),
    getDailyUsage(),
    getTokenBalance(),
    getAdWatchedToday(),
    hasUserApiKey(),
  ]);
  return deriveFreemiumStatus(
    premium,
    used,
    tokenBalance,
    isAdRewardAvailable(),
    byok,
    FREE_DAILY_LIMIT,
    AD_BONUS_DAILY_LIMIT,
    adWatchedToday,
  );
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
  const used = await getDailyUsage();
  if (used < FREE_DAILY_LIMIT) {
    await incrementDailyUsage();
  } else {
    await spendToken();
  }
}
