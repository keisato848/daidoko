/**
 * Shopping list service — the family's consolidated, persistent shopping list.
 *
 * Items come from manual entry or a recipe's ingredients. Matching uses the
 * normalized name (normalizeItemName) so the same item is not added twice while
 * unchecked. Family-scoped; web returns empty / no-ops. See
 * docs/買い物リスト・在庫設計.md §5.1.
 */
import { isNativePlatform } from '../db/client';
import { generateId } from '../utils/id';
import { isInStock } from '../utils/itemMatch';
import { normalizeItemName } from '../utils/itemName';
import { getRecipeDetail } from './recipe.service';
import type { ShoppingItem, ShoppingItemSource } from './types';

interface ShoppingRow {
  id: string;
  name: string;
  amount: string | null;
  checked: number;
  source: string;
  recipeId: string | null;
}

function rowToItem(row: ShoppingRow): ShoppingItem {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    checked: row.checked === 1,
    source: row.source as ShoppingItemSource,
    recipeId: row.recipeId,
  };
}

async function currentFamilyId(): Promise<string> {
  const { getCurrentFamily } = await import('./user.service');
  return getCurrentFamily().id;
}

/** All items, unchecked first, then by sort order / creation time. */
export async function getShoppingItems(): Promise<ShoppingItem[]> {
  if (!isNativePlatform) return [];
  const { eq, asc } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const rows = await getDb()
    .select({
      id: schema.shoppingItems.id,
      name: schema.shoppingItems.name,
      amount: schema.shoppingItems.amount,
      checked: schema.shoppingItems.checked,
      source: schema.shoppingItems.source,
      recipeId: schema.shoppingItems.recipeId,
    })
    .from(schema.shoppingItems)
    .where(eq(schema.shoppingItems.familyId, await currentFamilyId()))
    .orderBy(
      asc(schema.shoppingItems.checked),
      asc(schema.shoppingItems.sortOrder),
      asc(schema.shoppingItems.createdAt),
    );

  return rows.map(rowToItem);
}

/**
 * Add an item. Skips (returns null) if the same normalized name is already on
 * the list unchecked, or the name is blank / non-native.
 */
export async function addShoppingItem(
  name: string,
  amount?: string,
  options?: { source?: ShoppingItemSource; recipeId?: string },
): Promise<ShoppingItem | null> {
  const trimmed = name.trim();
  if (!trimmed || !isNativePlatform) return null;

  const { eq, and } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const familyId = await currentFamilyId();
  const nameNormalized = normalizeItemName(trimmed);

  const existing = await db
    .select({ id: schema.shoppingItems.id })
    .from(schema.shoppingItems)
    .where(
      and(
        eq(schema.shoppingItems.familyId, familyId),
        eq(schema.shoppingItems.nameNormalized, nameNormalized),
        eq(schema.shoppingItems.checked, 0),
      ),
    )
    .limit(1);
  if (existing.length > 0) return null;

  const id = generateId();
  const amountValue = amount?.trim() ? amount.trim() : null;
  const source = options?.source ?? 'manual';
  await db.insert(schema.shoppingItems).values({
    id,
    familyId,
    name: trimmed,
    nameNormalized,
    amount: amountValue,
    checked: 0,
    source,
    recipeId: options?.recipeId ?? null,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    checkedAt: null,
  });

  return {
    id,
    name: trimmed,
    amount: amountValue,
    checked: false,
    source,
    recipeId: options?.recipeId ?? null,
  };
}

/** Add all of a recipe's ingredients to the list. Returns how many were added. */
export async function addRecipeIngredientsToList(recipeId: string): Promise<number> {
  if (!isNativePlatform) return 0;
  const detail = await getRecipeDetail(recipeId);
  if (!detail) return 0;

  let added = 0;
  for (const ingredient of detail.ingredients) {
    const result = await addShoppingItem(ingredient.name, ingredient.amount ?? undefined, {
      source: 'recipe',
      recipeId,
    });
    if (result) added += 1;
  }
  return added;
}

/**
 * Add only the recipe's ingredients NOT currently in the pantry (足りない材料).
 * With an empty pantry this equals addRecipeIngredientsToList. Returns count added.
 */
export async function addMissingRecipeIngredientsToList(recipeId: string): Promise<number> {
  if (!isNativePlatform) return 0;
  const detail = await getRecipeDetail(recipeId);
  if (!detail) return 0;

  const { getInStockNormalizedNames } = await import('./pantry.service');
  const pantryNames = await getInStockNormalizedNames();

  let added = 0;
  for (const ingredient of detail.ingredients) {
    if (isInStock(ingredient.name, pantryNames)) continue;
    const result = await addShoppingItem(ingredient.name, ingredient.amount ?? undefined, {
      source: 'recipe',
      recipeId,
    });
    if (result) added += 1;
  }
  return added;
}

export async function setShoppingItemChecked(id: string, checked: boolean): Promise<void> {
  if (!isNativePlatform) return;
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  await getDb()
    .update(schema.shoppingItems)
    .set({ checked: checked ? 1 : 0, checkedAt: checked ? new Date().toISOString() : null })
    .where(eq(schema.shoppingItems.id, id));
}

export async function removeShoppingItem(id: string): Promise<void> {
  if (!isNativePlatform) return;
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  await getDb().delete(schema.shoppingItems).where(eq(schema.shoppingItems.id, id));
}

/** Remove all checked (= already bought) items. */
export async function clearCheckedShoppingItems(): Promise<void> {
  if (!isNativePlatform) return;
  const { eq, and } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  await getDb()
    .delete(schema.shoppingItems)
    .where(
      and(
        eq(schema.shoppingItems.familyId, await currentFamilyId()),
        eq(schema.shoppingItems.checked, 1),
      ),
    );
}
