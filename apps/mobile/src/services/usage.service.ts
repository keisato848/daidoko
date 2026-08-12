/**
 * Freemium usage service — device-local quota for AI photo-recipes.
 *
 * 無料枠は**初回の FREE_LIFETIME_LIMIT 回だけ**（既定 1・日次リセットなし。
 * 2026-08-12 に「毎日1回」から変更 — ユーザー判断）。使い切ったら、
 * リワード広告を見るたびに 1 回ぶんのトークンが貯まる。トークンは無期限で、
 * 視聴は 1 日 AD_BONUS_DAILY_LIMIT 回まで（獲得レートの上限であって当日消費の
 * 縛りではない）。Premium (RevenueCat) bypasses the quota. The server's global
 * cap remains the real cost ceiling. See docs/フリーミアム設計.md.
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
/** Max rewarded-ad watches (token grants) per day. Earn-rate limiter only — banked tokens never expire. */
export const AD_BONUS_DAILY_LIMIT = 3;

const USAGE_KEY_PREFIX = 'ai_photo_recipe_usage:';
/** 生涯の無料枠消費数。日付キーを持たない = リセットされない。 */
const LIFETIME_FREE_KEY = 'ai_photo_recipe_free_lifetime_used';
const AD_WATCH_KEY_PREFIX = 'ai_photo_recipe_ad_watch:';
const TOKEN_BALANCE_KEY = 'ai_photo_recipe_token_balance';
const LAUNCH_BONUS_KEY = 'launch_bonus_2026_07';
const LAUNCH_BONUS_ANNOUNCE_KEY = 'launch_bonus_announced';

/** リリース記念ボーナスで一度だけ配るトークン数。 */
export const LAUNCH_BONUS_TOKENS = 3;

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

/** 生涯の無料枠をいくつ使ったか（リセットされない）。 */
export async function getLifetimeFreeUsed(): Promise<number> {
  return readCount(LIFETIME_FREE_KEY);
}

async function incrementLifetimeFreeUsed(): Promise<void> {
  await setAppMeta(LIFETIME_FREE_KEY, String((await getLifetimeFreeUsed()) + 1));
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

/**
 * リリース記念ボーナス: 端末（インストール）ごとに一度だけ、無条件でトークンを
 * まとめて付与する。評価・レビューとは一切連動しない（Play ポリシー上、評価への
 * 見返りは禁止のため、条件付き付与は実装しない）。付与済みなら no-op で false。
 */
export async function grantLaunchBonusOnce(): Promise<boolean> {
  if ((await getAppMeta(LAUNCH_BONUS_KEY)) != null) return false;
  // 先にフラグを立てる（途中失敗時に二重付与するより取りこぼす方を選ぶ）
  await setAppMeta(LAUNCH_BONUS_KEY, new Date().toISOString());
  await setTokenBalance((await getTokenBalance()) + LAUNCH_BONUS_TOKENS);
  // 付与しただけでは**完全に無言**で、設定を開かないと気づけなかった（R5 問題1）。
  // ホームで一度だけ知らせるための予約。見せた側が消す
  await setAppMeta(LAUNCH_BONUS_ANNOUNCE_KEY, 'pending');
  return true;
}

/**
 * 記念ボーナスの告知がまだ出ていないか。
 * 付与直後にアプリが落ちても次の起動で出せるよう、フラグで持ち越す。
 */
export async function hasPendingLaunchBonusAnnouncement(): Promise<boolean> {
  return (await getAppMeta(LAUNCH_BONUS_ANNOUNCE_KEY)) === 'pending';
}

export async function clearLaunchBonusAnnouncement(): Promise<void> {
  await setAppMeta(LAUNCH_BONUS_ANNOUNCE_KEY, 'done');
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
    getLifetimeFreeUsed(),
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
    FREE_LIFETIME_LIMIT,
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
  const used = await getLifetimeFreeUsed();
  if (used < FREE_LIFETIME_LIMIT) {
    await incrementLifetimeFreeUsed();
  } else {
    await spendToken();
  }
}
