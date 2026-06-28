/**
 * Freemium usage service — device-local monthly quota for AI photo-recipes.
 *
 * The free tier allows FREE_MONTHLY_LIMIT successful cloud inferences per
 * calendar month, counted in app_meta (key per YYYY-MM, so it auto-resets when
 * the month changes). Premium (RevenueCat) bypasses the quota. The server's
 * global cap remains the real cost ceiling. See docs/フリーミアム設計.md.
 */
import { getAppMeta, setAppMeta } from './app-meta.service';
import { isPremium } from './entitlement.service';

/** Free AI photo-recipes allowed per calendar month. */
export const FREE_MONTHLY_LIMIT = 3;

const USAGE_KEY_PREFIX = 'ai_photo_recipe_usage:';

export interface FreemiumStatus {
  isPremium: boolean;
  /** Successful cloud inferences used this month (0 for premium display). */
  used: number;
  limit: number;
  /** Remaining free uses; Infinity for premium. */
  remaining: number;
  canInfer: boolean;
}

/** Calendar-month key, e.g. "2026-06". */
export function currentMonthKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function remainingFree(used: number, limit: number = FREE_MONTHLY_LIMIT): number {
  return Math.max(0, limit - used);
}

/** Pure mapping from (premium, used) to the gate status. */
export function deriveFreemiumStatus(
  premium: boolean,
  used: number,
  limit: number = FREE_MONTHLY_LIMIT,
): FreemiumStatus {
  if (premium) {
    return { isPremium: true, used: 0, limit, remaining: Number.POSITIVE_INFINITY, canInfer: true };
  }
  const remaining = remainingFree(used, limit);
  return { isPremium: false, used, limit, remaining, canInfer: remaining > 0 };
}

export async function getMonthlyUsage(date: Date = new Date()): Promise<number> {
  const raw = await getAppMeta(USAGE_KEY_PREFIX + currentMonthKey(date));
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export async function incrementMonthlyUsage(date: Date = new Date()): Promise<number> {
  const next = (await getMonthlyUsage(date)) + 1;
  await setAppMeta(USAGE_KEY_PREFIX + currentMonthKey(date), String(next));
  return next;
}

/** Combined premium + quota status for the gate / UI. */
export async function getFreemiumStatus(): Promise<FreemiumStatus> {
  const [premium, used] = await Promise.all([isPremium(), getMonthlyUsage()]);
  return deriveFreemiumStatus(premium, used);
}

/**
 * Count one successful cloud (paid) inference against the free quota.
 * No-op for premium users. Call only when the AI actually returned a draft.
 */
export async function recordCloudInference(): Promise<void> {
  if (await isPremium()) return;
  await incrementMonthlyUsage();
}
