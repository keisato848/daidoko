/**
 * Cookable service — ranks recipes by how much of their ingredients are in the
 * pantry ("在庫で作れる"). Coverage = in-stock ingredients / total ingredients,
 * matched by normalized name. Family-scoped via the pantry; web returns empty.
 * See docs/買い物リスト・在庫設計.md §5.4.
 */
import { isNativePlatform } from '../db/client';
import { isInStock } from '../utils/itemMatch';
import type { RecipeListItem } from './types';

export interface CookableRecipe {
  recipeId: string;
  title: string;
  cookTimeMin: number | null;
  heroPhotoUri: string | null;
  total: number;
  inStock: number;
  coverage: number; // 0..1
  missing: string[]; // ingredient display names not in stock
}

/**
 * Pure ranking: for each recipe, count how many of its ingredient names are in
 * the in-stock set (normalized), then sort by coverage desc, fewer-missing, title.
 */
export function rankByCoverage(recipes: RecipeListItem[], pantryNames: string[]): CookableRecipe[] {
  const ranked = recipes.map((recipe) => {
    const ingredients = recipe.ingredientNames;
    const missing: string[] = [];
    let inStock = 0;
    for (const name of ingredients) {
      if (isInStock(name, pantryNames)) {
        inStock += 1;
      } else {
        missing.push(name);
      }
    }
    const total = ingredients.length;
    return {
      recipeId: recipe.id,
      title: recipe.title,
      cookTimeMin: recipe.cookTimeMin,
      heroPhotoUri: recipe.heroPhotoUri,
      total,
      inStock,
      coverage: total > 0 ? inStock / total : 0,
      missing,
    };
  });

  ranked.sort(
    (a, b) =>
      b.coverage - a.coverage ||
      a.missing.length - b.missing.length ||
      a.title.localeCompare(b.title),
  );
  return ranked;
}

export async function getCookableRecipes(): Promise<CookableRecipe[]> {
  if (!isNativePlatform) return [];
  const { getRecipeList } = await import('./recipe.service');
  const { getInStockNormalizedNames } = await import('./pantry.service');
  const [recipes, inStock] = await Promise.all([getRecipeList(), getInStockNormalizedNames()]);
  return rankByCoverage(recipes, inStock);
}
