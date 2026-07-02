/**
 * Pantry service — the family's home inventory (在庫).
 *
 * Quantity × unit is managed strictly: adding the same item sums the quantity
 * (matched by JAN code when present, else normalized name + same unit). Also
 * provides the in-stock set used to compute a recipe's missing ingredients, and
 * "買った→在庫" (move checked shopping items into the pantry). Family-scoped; web
 * returns empty / no-ops. See docs/買い物リスト・在庫設計.md §5.2.
 */
import { isNativePlatform } from '../db/client';
import { parseAmount } from '../utils/amount';
import { generateId } from '../utils/id';
import { normalizeItemName } from '../utils/itemName';
import type { PantryItem } from './types';

interface PantryRow {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  lowStockThreshold: number | null;
  janCode: string | null;
}

function rowToItem(row: PantryRow): PantryItem {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    lowStockThreshold: row.lowStockThreshold,
    janCode: row.janCode,
  };
}

async function currentFamilyId(): Promise<string> {
  const { getCurrentFamily } = await import('./user.service');
  return getCurrentFamily().id;
}

/** Sum two optional quantities; null + null stays null (= unmanaged). */
function sumQuantity(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

export interface AddPantryOptions {
  quantity?: number | null;
  unit?: string | null;
  lowStockThreshold?: number | null;
  janCode?: string | null;
}

export async function getPantryItems(): Promise<PantryItem[]> {
  if (!isNativePlatform) return [];
  const { eq, asc } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const rows = await getDb()
    .select({
      id: schema.pantryItems.id,
      name: schema.pantryItems.name,
      quantity: schema.pantryItems.quantity,
      unit: schema.pantryItems.unit,
      lowStockThreshold: schema.pantryItems.lowStockThreshold,
      janCode: schema.pantryItems.janCode,
    })
    .from(schema.pantryItems)
    .where(eq(schema.pantryItems.familyId, await currentFamilyId()))
    .orderBy(asc(schema.pantryItems.name));

  return rows.map(rowToItem);
}

/**
 * Add stock. Upserts: an existing item with the same JAN (if given), or same
 * normalized name + same unit, has its quantity summed; otherwise inserts.
 */
export async function addPantryItem(
  name: string,
  options: AddPantryOptions = {},
): Promise<PantryItem | null> {
  const trimmed = name.trim();
  if (!trimmed || !isNativePlatform) return null;

  const { and, eq, isNull } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const familyId = await currentFamilyId();
  const nameNormalized = normalizeItemName(trimmed);
  const unit = options.unit?.trim() ? options.unit.trim() : null;
  const now = new Date().toISOString();

  // Find a match to merge into.
  const janCode = options.janCode?.trim() ? options.janCode.trim() : null;
  const match = janCode
    ? and(eq(schema.pantryItems.familyId, familyId), eq(schema.pantryItems.janCode, janCode))
    : and(
        eq(schema.pantryItems.familyId, familyId),
        eq(schema.pantryItems.nameNormalized, nameNormalized),
        unit == null ? isNull(schema.pantryItems.unit) : eq(schema.pantryItems.unit, unit),
      );

  const existing = await db
    .select({
      id: schema.pantryItems.id,
      name: schema.pantryItems.name,
      quantity: schema.pantryItems.quantity,
      unit: schema.pantryItems.unit,
      lowStockThreshold: schema.pantryItems.lowStockThreshold,
      janCode: schema.pantryItems.janCode,
    })
    .from(schema.pantryItems)
    .where(match)
    .limit(1);

  if (existing.length > 0) {
    const prev = existing[0];
    const quantity = sumQuantity(prev.quantity, options.quantity ?? null);
    await db
      .update(schema.pantryItems)
      .set({
        quantity,
        unit: unit ?? prev.unit,
        lowStockThreshold: options.lowStockThreshold ?? prev.lowStockThreshold,
        janCode: janCode ?? prev.janCode,
        updatedAt: now,
      })
      .where(eq(schema.pantryItems.id, prev.id));
    return {
      id: prev.id,
      name: prev.name,
      quantity,
      unit: unit ?? prev.unit,
      lowStockThreshold: options.lowStockThreshold ?? prev.lowStockThreshold,
      janCode: janCode ?? prev.janCode,
    };
  }

  const id = generateId();
  const item: PantryItem = {
    id,
    name: trimmed,
    quantity: options.quantity ?? null,
    unit,
    lowStockThreshold: options.lowStockThreshold ?? null,
    janCode,
  };
  await db.insert(schema.pantryItems).values({
    id,
    familyId,
    name: trimmed,
    nameNormalized,
    quantity: item.quantity,
    unit,
    lowStockThreshold: item.lowStockThreshold,
    janCode,
    createdAt: now,
    updatedAt: now,
  });
  return item;
}

export async function updatePantryItem(
  id: string,
  patch: {
    name?: string;
    quantity?: number | null;
    unit?: string | null;
    lowStockThreshold?: number | null;
  },
): Promise<void> {
  if (!isNativePlatform) return;
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const set = {
    updatedAt: new Date().toISOString(),
    ...(patch.name !== undefined
      ? { name: patch.name.trim(), nameNormalized: normalizeItemName(patch.name) }
      : {}),
    ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
    ...(patch.unit !== undefined ? { unit: patch.unit?.trim() ? patch.unit.trim() : null } : {}),
    ...(patch.lowStockThreshold !== undefined
      ? { lowStockThreshold: patch.lowStockThreshold }
      : {}),
  };

  await getDb().update(schema.pantryItems).set(set).where(eq(schema.pantryItems.id, id));
}

export async function removePantryItem(id: string): Promise<void> {
  if (!isNativePlatform) return;
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  await getDb().delete(schema.pantryItems).where(eq(schema.pantryItems.id, id));
}

/** Normalized names currently in stock (quantity null = unmanaged-but-present, or > 0). */
export async function getInStockNormalizedNames(): Promise<string[]> {
  if (!isNativePlatform) return [];
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const rows = await getDb()
    .select({
      nameNormalized: schema.pantryItems.nameNormalized,
      quantity: schema.pantryItems.quantity,
    })
    .from(schema.pantryItems)
    .where(eq(schema.pantryItems.familyId, await currentFamilyId()));

  return rows.filter((r) => r.quantity == null || r.quantity > 0).map((r) => r.nameNormalized);
}

/**
 * Move all checked shopping items into the pantry (買った→在庫): upsert each into
 * the pantry (parsing its amount), then remove it from the shopping list.
 * Returns how many were moved.
 */
export async function moveCheckedShoppingItemsToPantry(): Promise<number> {
  if (!isNativePlatform) return 0;
  const { getShoppingItems, removeShoppingItem } = await import('./shopping-list.service');
  const items = await getShoppingItems();
  const checked = items.filter((it) => it.checked);

  let moved = 0;
  for (const item of checked) {
    const { quantity, unit } = parseAmount(item.amount);
    const result = await addPantryItem(item.name, { quantity, unit });
    if (result) {
      await removeShoppingItem(item.id);
      moved += 1;
    }
  }
  return moved;
}
