/**
 * Freemium usage service — device-local daily quota for AI photo-recipes.
 *
 * Free tier = FREE_DAILY_LIMIT successful cloud inferences per calendar day,
 * counted in app_meta (key per YYYY-MM-DD, auto-resets daily). A free user who
 * is out of uses can watch a rewarded ad for one more, up to AD_BONUS_DAILY_LIMIT
 * per day (also device-local, capped). Premium (RevenueCat) bypasses the quota.
 * The server's global cap remains the real cost ceiling. See docs/フリーミアム設計.md.
 */
import { FREE_DAILY_LIMIT_CONFIG } from '../config';
import { isAdRewardAvailable } from './ad-reward.service';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { hasUserApiKey } from './byok.service';
import { isPremium } from './entitlement.service';

/** Free AI photo-recipes allowed per calendar day (build-time configurable, default 1). */
export const FREE_DAILY_LIMIT = FREE_DAILY_LIMIT_CONFIG;
/** Extra AI photo-recipes a free user can unlock per day by watching ads. */
export const AD_BONUS_DAILY_LIMIT = 3;

const USAGE_KEY_PREFIX = 'ai_photo_recipe_usage:';
const AD_BONUS_KEY_PREFIX = 'ai_photo_recipe_ad_bonus:';

export interface FreemiumStatus {
  isPremium: boolean;
  /** Unlimited via the user's own Gemini key (BYOK). */
  isByok: boolean;
  /** Successful cloud inferences used today (0 for premium display). */
  used: number;
  /** Effective allowance today (base + ad bonus); Infinity for premium. */
  limit: number;
  /** Remaining uses today; Infinity for premium. */
  remaining: number;
  canInfer: boolean;
  /** Offer a rewarded ad: out of uses, ads available, bonus cap not reached. */
  canWatchAdForMore: boolean;
  /** Ad-unlocked extra uses granted today. */
  adBonusGranted: number;
  adBonusLimit: number;
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

/** Pure mapping from (premium, used, ad bonus, ad availability) to gate status. */
export function deriveFreemiumStatus(
  premium: boolean,
  used: number,
  adBonusGranted = 0,
  adAvailable = false,
  byok = false,
  baseLimit: number = FREE_DAILY_LIMIT,
  bonusLimit: number = AD_BONUS_DAILY_LIMIT,
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
      adBonusGranted: 0,
      adBonusLimit: bonusLimit,
    };
  }
  const grantedCapped = Math.min(Math.max(0, adBonusGranted), bonusLimit);
  const limit = baseLimit + grantedCapped;
  const remaining = Math.max(0, limit - used);
  return {
    isPremium: false,
    isByok: false,
    used,
    limit,
    remaining,
    canInfer: remaining > 0,
    canWatchAdForMore: adAvailable && remaining === 0 && grantedCapped < bonusLimit,
    adBonusGranted: grantedCapped,
    adBonusLimit: bonusLimit,
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

export async function getAdBonusGranted(date: Date = new Date()): Promise<number> {
  return readCount(AD_BONUS_KEY_PREFIX + currentDayKey(date));
}

/** Grant one ad-unlocked extra use (capped at AD_BONUS_DAILY_LIMIT). Returns the new total. */
export async function grantAdBonus(date: Date = new Date()): Promise<number> {
  const current = await getAdBonusGranted(date);
  if (current >= AD_BONUS_DAILY_LIMIT) return current;
  const next = current + 1;
  await setAppMeta(AD_BONUS_KEY_PREFIX + currentDayKey(date), String(next));
  return next;
}

/** Combined premium + quota + ad status for the gate / UI. */
export async function getFreemiumStatus(): Promise<FreemiumStatus> {
  const [premium, used, adBonusGranted, byok] = await Promise.all([
    isPremium(),
    getDailyUsage(),
    getAdBonusGranted(),
    hasUserApiKey(),
  ]);
  return deriveFreemiumStatus(premium, used, adBonusGranted, isAdRewardAvailable(), byok);
}

/**
 * Count one successful cloud inference against the quota.
 * No-op for premium and BYOK users (BYOK uses the user's own key/quota).
 * Call only when the AI (our managed server) actually returned a draft.
 */
export async function recordCloudInference(): Promise<void> {
  if (await isPremium()) return;
  if (await hasUserApiKey()) return;
  await incrementDailyUsage();
}
