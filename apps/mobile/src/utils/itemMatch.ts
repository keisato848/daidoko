/**
 * Ingredient matching for the in-stock features (P4 cookable, P2a 足りない材料).
 *
 * Two maintenance-free rules, plus an optional data-driven alias map:
 *   1. exact match on the normalized name,
 *   2. substring containment (ぶなしめじ ⊇ しめじ, 春よ恋強力小麦粉 ⊇ 小麦粉),
 *      guarded by a min length so short homophones don't collide (酒/鮭),
 *   3. an optional `aliases` map (normalized → canonical) bridging kanji↔reading
 *      and product↔generic (とっとごたまご→卵). This map is NOT hardcoded here —
 *      it is built from a cache that the AI name-resolver fills on demand, so the
 *      source carries no ever-growing synonym dictionary. With no map (or no AI),
 *      matching degrades gracefully to rules 1–2.
 * See docs/買い物リスト・在庫設計.md §6.
 */
import { normalizeItemName } from './itemName';

const MIN_SUBSTRING_LENGTH = 3;

function contains(longer: string, shorter: string): boolean {
  return shorter.length >= MIN_SUBSTRING_LENGTH && longer.includes(shorter);
}

/** Whether two item names refer to the same ingredient. `aliases` maps a
 *  normalized name to a canonical form (from the AI-resolution cache). */
export function itemNamesMatch(
  a: string,
  b: string,
  aliases: Record<string, string> = {},
): boolean {
  const na = normalizeItemName(a);
  const nb = normalizeItemName(b);
  if (!na || !nb) return false;

  const ca = aliases[na] ?? na;
  const cb = aliases[nb] ?? nb;
  if (ca === cb) return true;

  return contains(na, nb) || contains(nb, na) || contains(ca, cb) || contains(cb, ca);
}

/** Whether an ingredient is covered by any pantry item name. */
export function isInStock(
  ingredientName: string,
  pantryNames: string[],
  aliases: Record<string, string> = {},
): boolean {
  return pantryNames.some((pantryName) => itemNamesMatch(ingredientName, pantryName, aliases));
}
