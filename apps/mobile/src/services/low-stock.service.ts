/**
 * Low-stock notification service (P3) — detect pantry items whose quantity has
 * fallen to/below their per-item threshold and raise ONE batched local
 * notification per calendar day. Thresholds are opt-in per item; with none set
 * nothing ever fires (and notification permission is never requested).
 * Triggered on app launch and after stock decreases (pantry stepper, meal
 * consumption, threshold edit). See docs/買い物リスト・在庫設計.md §5.5.
 */
import { isNativePlatform } from '../db/client';
import { normalizeItemName } from '../utils/itemName';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { presentLowStockNotification } from './notification.service';
import { getPantryItems } from './pantry.service';
import { addShoppingItem } from './shopping-list.service';
import type { PantryItem } from './types';
import { t, tCount } from '../i18n';

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
  const rest =
    names.length > MAX_NAMES_IN_BODY
      ? tCount('notification.lowStockMore', names.length - MAX_NAMES_IN_BODY)
      : '';
  return t('notification.lowStockBody', { names: `${head}${rest}` });
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

/**
 * Add every currently-low-stock pantry item to the shopping list
 * (source='low_stock'). Used by the low-stock notification's tap handler —
 * no confirmation screen, since the notification itself already named the
 * items. Returns how many were actually added (dedup against an existing
 * unchecked entry is handled by addShoppingItem).
 */
export async function addAllLowStockToShoppingList(): Promise<number> {
  if (!isNativePlatform) return 0;
  const low = filterLowStock(await getPantryItems());

  // **正規化名で畳んでから追加する（v13）。** グループが入ったことで「冷蔵庫の米」と
  // 「〇〇の米」が別行として在庫に並ぶようになった。両方が残りわずかだと、そのままでは
  // 買い物リストに「米」が2行入る。買う側に必要なのは「米を買う」ことだけなので畳む。
  const seen = new Set<string>();
  let added = 0;
  for (const it of low) {
    const key = normalizeItemName(it.name);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const result = await addShoppingItem(it.name, undefined, { source: 'low_stock' });
    if (result) added += 1;
  }
  return added;
}
