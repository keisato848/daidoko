/**
 * Ingredient / shopping / pantry item name normalization for matching.
 *
 * Produces a stable key so the same item written differently (full/half-width,
 * katakana/hiragana, case, spacing) compares equal. Combines NFKC (full↔half
 * width) with the existing kana normalizer (katakana→hiragana, lowercase, trim)
 * and strips all whitespace. See docs/買い物リスト・在庫設計.md §6.
 */
import { normalizeKana } from './kana';

export function normalizeItemName(name: string): string {
  const nfkc = typeof name.normalize === 'function' ? name.normalize('NFKC') : name;
  return normalizeKana(nfkc).replace(/\s+/g, '');
}
