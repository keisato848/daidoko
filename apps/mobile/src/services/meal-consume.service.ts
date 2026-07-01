/**
 * Meal-consumption service (experimental, P6) — infer a meal's consumed
 * ingredients, match them to pantry items (via the name matcher + AI alias
 * cache), and, on confirmation, decrement those items. Family-scoped; web no-ops.
 * See docs/買い物リスト・在庫設計.md §5.7.
 */
import { isNativePlatform } from '../db/client';
import { itemNamesMatch } from '../utils/itemMatch';
import { inferMealFromVision, type MealIngredient } from './meal-vision.provider';

export interface ConsumptionMatch {
  pantryItemId: string;
  pantryName: string;
  quantity: number | null;
  unit: string | null;
  inferredName: string;
}

export interface MealConsumption {
  dish: string | null;
  ingredients: MealIngredient[];
  matches: ConsumptionMatch[];
}

/** Photograph a meal → inferred ingredients + the pantry items they match. */
export async function inferMealConsumption(args: {
  localPath: string;
  mimeType: string;
}): Promise<MealConsumption> {
  const inference = await inferMealFromVision(args);
  if (!inference.isMeal || !isNativePlatform) {
    return { dish: inference.dish, ingredients: inference.ingredients, matches: [] };
  }

  const { getPantryItems } = await import('./pantry.service');
  const { getAliasMap } = await import('./name-alias.service');
  const [pantry, aliases] = await Promise.all([getPantryItems(), getAliasMap()]);

  const matches: ConsumptionMatch[] = [];
  const usedIds = new Set<string>();
  for (const ingredient of inference.ingredients) {
    const item = pantry.find(
      (p) => !usedIds.has(p.id) && itemNamesMatch(ingredient.name, p.name, aliases),
    );
    if (item) {
      usedIds.add(item.id);
      matches.push({
        pantryItemId: item.id,
        pantryName: item.name,
        quantity: item.quantity,
        unit: item.unit,
        inferredName: ingredient.name,
      });
    }
  }
  return { dish: inference.dish, ingredients: inference.ingredients, matches };
}

/** Decrement the given pantry items by one (removing any that reach zero). */
export async function applyConsumption(pantryItemIds: string[]): Promise<number> {
  if (!isNativePlatform || pantryItemIds.length === 0) return 0;
  const { getPantryItems, updatePantryItem, removePantryItem } = await import('./pantry.service');
  const pantry = await getPantryItems();

  let applied = 0;
  for (const id of pantryItemIds) {
    const item = pantry.find((p) => p.id === id);
    if (!item) continue;
    if (item.quantity == null || item.quantity <= 1) {
      await removePantryItem(id);
    } else {
      await updatePantryItem(id, { quantity: item.quantity - 1 });
    }
    applied += 1;
  }
  return applied;
}
