/**
 * Low-stock notification service (P3) — detect pantry items whose quantity has
 * fallen to/below their per-item threshold and raise ONE batched local
 * notification per calendar day. Thresholds are opt-in per item; with none set
 * nothing ever fires (and notification permission is never requested).
 * Triggered on app launch and after stock decreases (pantry stepper, meal
 * consumption, threshold edit). See docs/買い物リスト・在庫設計.md §5.5.
 */
import { isNativePlatform } from '../db/client';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { presentLowStockNotification } from './notification.service';
import { getPantryItems } from './pantry.service';
import type { PantryItem } from './types';

const NOTIFIED_DAY_KEY = 'low_stock_notified_day';
const MAX_NAMES_IN_BODY = 5;

/** Calendar-day key, e.g. "2026-07-02" (local time). */
function dayKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Items at/below their threshold (both quantity and threshold must be set). */
export function filterLowStock(items: PantryItem[]): PantryItem[] {
  return items.filter(
    (it) =>
      it.quantity != null && it.lowStockThreshold != null && it.quantity <= it.lowStockThreshold,
  );
}

/** One batched message: 「卵、牛乳 ほか2件 の残りが少なくなっています。…」 */
export function buildLowStockBody(names: string[]): string {
  const head = names.slice(0, MAX_NAMES_IN_BODY).join('、');
  const rest = names.length > MAX_NAMES_IN_BODY ? ` ほか${names.length - MAX_NAMES_IN_BODY}件` : '';
  return `${head}${rest} の残りが少なくなっています。買い物リストに追加しましょう。`;
}

/**
 * Check the pantry and notify once per day if anything is low.
 * Returns true when a notification was actually presented. If the permission
 * is denied the day is NOT consumed, so it can retry once permission is granted.
 */
export async function checkAndNotifyLowStock(): Promise<boolean> {
  if (!isNativePlatform) return false;

  const low = filterLowStock(await getPantryItems());
  if (low.length === 0) return false;

  const today = dayKey();
  if ((await getAppMeta(NOTIFIED_DAY_KEY)) === today) return false;

  const id = await presentLowStockNotification(buildLowStockBody(low.map((it) => it.name)));
  if (id == null) return false;

  await setAppMeta(NOTIFIED_DAY_KEY, today);
  return true;
}
