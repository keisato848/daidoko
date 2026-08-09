/**
 * Recipe list sorting (S04). Pure + deterministic for testability.
 */
import { getLocale, t } from '../i18n';
import type { RecipeListItem } from '../services/types';

export type RecipeSortKey = 'recent' | 'cookCount' | 'rating' | 'cookTime' | 'name';

/** **ラベルは持たない。** 定数に焼き付けると import 時のロケールで固定される */
export const RECIPE_SORT_KEYS: readonly RecipeSortKey[] = [
  'recent',
  'cookCount',
  'rating',
  'cookTime',
  'name',
];

export const DEFAULT_RECIPE_SORT: RecipeSortKey = 'recent';

export function recipeSortLabel(key: RecipeSortKey): string {
  switch (key) {
    case 'recent':
      return t('recipe.list.sortBy.recent');
    case 'cookCount':
      return t('recipe.list.sortBy.cookCount');
    case 'rating':
      return t('recipe.list.sortBy.rating');
    case 'cookTime':
      return t('recipe.list.sortBy.cookTime');
    case 'name':
      return t('recipe.list.sortBy.name');
  }
}

// 並び順は言語で変わる（かな順 / アルファベット順）。ja 固定にすると
// 英語のレシピ名が期待どおりに並ばない
function byName(a: RecipeListItem, b: RecipeListItem): number {
  return a.title.localeCompare(b.title, getLocale());
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
