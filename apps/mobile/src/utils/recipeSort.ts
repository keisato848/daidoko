/**
 * Recipe list sorting (S04). Pure + deterministic for testability.
 */
import type { RecipeListItem } from '../services/types';

export type RecipeSortKey = 'recent' | 'cookCount' | 'rating' | 'cookTime' | 'name';

export const RECIPE_SORT_OPTIONS: { key: RecipeSortKey; label: string }[] = [
  { key: 'recent', label: '新着順' },
  { key: 'cookCount', label: 'よく作る順' },
  { key: 'rating', label: '評価が高い順' },
  { key: 'cookTime', label: '調理時間が短い順' },
  { key: 'name', label: '名前順' },
];

export const DEFAULT_RECIPE_SORT: RecipeSortKey = 'recent';

export function recipeSortLabel(key: RecipeSortKey): string {
  return RECIPE_SORT_OPTIONS.find((o) => o.key === key)?.label ?? '';
}

function byName(a: RecipeListItem, b: RecipeListItem): number {
  return a.title.localeCompare(b.title, 'ja');
}

/** Returns a new sorted array; the input is not mutated. Ties break by name. */
export function sortRecipes(items: RecipeListItem[], key: RecipeSortKey): RecipeListItem[] {
  const copy = [...items];
  switch (key) {
    case 'recent':
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b));
    case 'cookCount':
      return copy.sort((a, b) => b.cookCount - a.cookCount || byName(a, b));
    case 'rating':
      return copy.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byName(a, b));
    case 'cookTime':
      return copy.sort(
        (a, b) => (a.cookTimeMin ?? Infinity) - (b.cookTimeMin ?? Infinity) || byName(a, b),
      );
    case 'name':
      return copy.sort(byName);
  }
}
