/**
 * Freemium usage service — device-local daily quota for AI photo-recipes.
 *
 * The free tier allows FREE_DAILY_LIMIT successful cloud inferences per calendar
 * day, counted in app_meta (key per YYYY-MM-DD, so it auto-resets each day).
 * Premium (RevenueCat) bypasses the quota. The server's global cap remains the
 * real cost ceiling. See docs/フリーミアム設計.md.
 */
import { getAppMeta, setAppMeta } from './app-meta.service';
import { isPremium } from './entitlement.service';

/** Free AI photo-recipes allowed per calendar day. */
export const FREE_DAILY_LIMIT = 1;

const USAGE_KEY_PREFIX = 'ai_photo_recipe_usage:';

export interface FreemiumStatus {
  isPremium: boolean;
  /** Successful cloud inferences used today (0 for premium display). */
  used: number;
  limit: number;
  /** Remaining free uses; Infinity for premium. */
  remaining: number;
  canInfer: boolean;
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

/** Pure mapping from (premium, used) to the gate status. */
export function deriveFreemiumStatus(
  premium: boolean,
  used: number,
  limit: number = FREE_DAILY_LIMIT,
): FreemiumStatus {
  if (premium) {
    return { isPremium: true, used: 0, limit, remaining: Number.POSITIVE_INFINITY, canInfer: true };
  }
  const remaining = remainingFree(used, limit);
  return { isPremium: false, used, limit, remaining, canInfer: remaining > 0 };
}

export async function getDailyUsage(date: Date = new Date()): Promise<number> {
  const raw = await getAppMeta(USAGE_KEY_PREFIX + currentDayKey(date));
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export async function incrementDailyUsage(date: Date = new Date()): Promise<number> {
  const next = (await getDailyUsage(date)) + 1;
  await setAppMeta(USAGE_KEY_PREFIX + currentDayKey(date), String(next));
  return next;
}

/** Combined premium + quota status for the gate / UI. */
export async function getFreemiumStatus(): Promise<FreemiumStatus> {
  const [premium, used] = await Promise.all([isPremium(), getDailyUsage()]);
  return deriveFreemiumStatus(premium, used);
}

/**
 * Count one successful cloud (paid) inference against the free quota.
 * No-op for premium users. Call only when the AI actually returned a draft.
 */
export async function recordCloudInference(): Promise<void> {
  if (await isPremium()) return;
  await incrementDailyUsage();
}
