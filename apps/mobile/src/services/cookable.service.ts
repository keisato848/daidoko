/**
 * Cookable service — ranks recipes by how much of their ingredients are in the
 * pantry ("在庫で作れる"). Coverage = in-stock ingredients / total ingredients,
 * matched by normalized name. Family-scoped via the pantry; web returns empty.
 * See docs/買い物リスト・在庫設計.md §5.4.
 */
import { isNativePlatform } from '../db/client';
import { isInStock, itemNamesMatch } from '../utils/itemMatch';
import { normalizeItemName } from '../utils/itemName';
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
export function rankByCoverage(
  recipes: RecipeListItem[],
  pantryNames: string[],
  aliases: Record<string, string> = {},
): CookableRecipe[] {
  const ranked = recipes.map((recipe) => {
    const ingredients = recipe.ingredientNames;
    const missing: string[] = [];
    let inStock = 0;
    for (const name of ingredients) {
      if (isInStock(name, pantryNames, aliases)) {
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

/**
 * 突合で**どちらにも当たらなかった**正規化名を集める（AI に解決を頼む候補）。
 *
 * 名寄せ辞書は当初「在庫名 → canonical」だけを持ち、埋めるのも cookable 画面だけだった。
 * 突合は 在庫 × レシピ材料 の**両側**で起きるので、片側しか写していないと
 * 「AI が選んだ表記とレシピの表記が偶然揃ったときだけ効く」状態になる
 * （docs/買い物リスト・在庫設計.md §6）。
 *
 * ここでは**ルール（完全一致・部分一致）と現在の辞書で当たらなかった名前だけ**を返す。
 * 「玉ねぎ」のように素直な名前はルールで当たるので AI に投げない — 解決の対象を
 * 「解決する価値があった名前」に絞ると、呼び出し回数は語彙数へ自然に収束する。
 */
export function collectUnmatchedNames(
  recipes: RecipeListItem[],
  pantryNames: string[],
  aliases: Record<string, string> = {},
): string[] {
  const ingredients = new Set<string>();
  for (const recipe of recipes) {
    for (const name of recipe.ingredientNames) {
      const normalized = normalizeItemName(name);
      if (normalized) ingredients.add(normalized);
    }
  }
  const pantry = pantryNames.map((name) => normalizeItemName(name)).filter(Boolean);

  const unmatched = new Set<string>();
  for (const ingredient of ingredients) {
    if (!pantry.some((item) => itemNamesMatch(ingredient, item, aliases)))
      unmatched.add(ingredient);
  }
  for (const item of pantry) {
    let matched = false;
    for (const ingredient of ingredients) {
      if (itemNamesMatch(item, ingredient, aliases)) {
        matched = true;
        break;
      }
    }
    if (!matched) unmatched.add(item);
  }
  return [...unmatched];
}

export async function getCookableRecipes(groups?: readonly string[]): Promise<CookableRecipe[]> {
  if (!isNativePlatform) return [];
  const { getRecipeList } = await import('./recipe.service');
  const { getInStockNormalizedNames } = await import('./pantry.service');
  const { getAliasMap } = await import('./name-alias.service');
  const [recipes, inStock, aliases] = await Promise.all([
    getRecipeList(),
    getInStockNormalizedNames(groups),
    getAliasMap(),
  ]);
  return rankByCoverage(recipes, inStock, aliases);
}
