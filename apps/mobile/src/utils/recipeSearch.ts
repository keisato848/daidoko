/**
 * Recipe list search matching (S04 検索).
 *
 * The list search is a client-side filter (FTS5 is not wired to any screen);
 * raw includes() comparison could not bridge 「タマゴ」⇄「たまご」 or full-width
 * input. Both sides go through normalizeItemName (NFKC + katakana→hiragana +
 * lowercase + no spaces) — the same key the pantry matcher uses — across
 * title / reading / tags / ingredient names. The AI name-resolution cache
 * (name_aliases) additionally bridges kanji⇄reading (卵⇄たまご) when present;
 * with an empty cache matching degrades gracefully to normalization only.
 */
import { normalizeItemName } from './itemName';

export interface RecipeSearchFields {
  title: string;
  titleReading: string | null;
  tags: string[];
  ingredientNames: string[];
}

/** Whether a recipe matches the search query (kana/width/case-insensitive). */
export function recipeMatchesQuery(
  recipe: RecipeSearchFields,
  query: string,
  aliases: Record<string, string> = {},
): boolean {
  const q = normalizeItemName(query);
  if (!q) return true;
  const qCanonical = aliases[q] != null ? normalizeItemName(aliases[q]) : q;

  const haystacks = [
    recipe.title,
    recipe.titleReading ?? '',
    ...recipe.tags,
    ...recipe.ingredientNames,
  ];
  return haystacks.some((raw) => {
    if (!raw) return false;
    const h = normalizeItemName(raw);
    if (h.includes(q)) return true;
    const hCanonical = aliases[h];
    if (hCanonical != null && normalizeItemName(hCanonical).includes(qCanonical)) return true;
    return qCanonical !== q && h.includes(qCanonical);
  });
}
