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
  groupName: string | null;
  expiresOn: string | null;
}

function rowToItem(row: PantryRow): PantryItem {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    lowStockThreshold: row.lowStockThreshold,
    janCode: row.janCode,
    groupName: row.groupName,
    expiresOn: row.expiresOn,
  };
}

async function currentFamilyId(): Promise<string> {
  const { getCurrentFamily } = await import('./user.service');
  return getCurrentFamily().id;
}

/**
 * 「未設定」グループを絞り込みで指す番兵。DB は null で持つが、選択状態は
 * 文字列の集合で扱いたいので、UI と service の間だけこの値を使う。
 */
export const UNGROUPED = '__ungrouped__';

/** Sum two optional quantities; null + null stays null (= unmanaged). */
function sumQuantity(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * 賞味期限のマージ規則（v13）。**近い方（早い日付）を残す。**
 *
 * 在庫は同じ品目を 1 行に合算するので、期限は行に 1 つしか持てない。先に使い切るのは
 * 古い方なので、早い日付を残しておけば「そろそろ使ったほうがいい」の判断には足りる。
 * 片方が未設定なら、入っている方を採る（せっかく入れた情報を捨てない）。
 *
 * 判断が入っている箇所なのでテストから触れるよう export する（外から呼ぶ用途は無い）。
 */
export function nearerExpiry(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

export interface AddPantryOptions {
  quantity?: number | null;
  unit?: string | null;
  lowStockThreshold?: number | null;
  janCode?: string | null;
  /** 置き場所・用途のグループ（未指定 = 未設定バケツ）。合算の鍵に入る */
  groupName?: string | null;
  /** 賞味期限 YYYY-MM-DD（任意） */
  expiresOn?: string | null;
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
      groupName: schema.pantryItems.groupName,
      expiresOn: schema.pantryItems.expiresOn,
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
  const groupName = options.groupName?.trim() ? options.groupName.trim() : null;
  const expiresOn = options.expiresOn?.trim() ? options.expiresOn.trim() : null;
  const now = new Date().toISOString();

  // Find a match to merge into.
  //
  // **グループも鍵に入れる（v13）。** 同じ米が「パントリー」と「〇〇の米」に別々にあるのは
  // 正常なので、鍵から外すと勝手に 1 行へまとめられてしまう。JAN 一致でも同じ理由でグループを見る
  // （同じ商品を備蓄と冷蔵庫に分けて持つことがある）。未設定（null）同士は同じバケツ。
  const groupMatch =
    groupName == null
      ? isNull(schema.pantryItems.groupName)
      : eq(schema.pantryItems.groupName, groupName);
  const janCode = options.janCode?.trim() ? options.janCode.trim() : null;
  const match = janCode
    ? and(
        eq(schema.pantryItems.familyId, familyId),
        eq(schema.pantryItems.janCode, janCode),
        groupMatch,
      )
    : and(
        eq(schema.pantryItems.familyId, familyId),
        eq(schema.pantryItems.nameNormalized, nameNormalized),
        unit == null ? isNull(schema.pantryItems.unit) : eq(schema.pantryItems.unit, unit),
        groupMatch,
      );

  const existing = await db
    .select({
      id: schema.pantryItems.id,
      name: schema.pantryItems.name,
      quantity: schema.pantryItems.quantity,
      unit: schema.pantryItems.unit,
      lowStockThreshold: schema.pantryItems.lowStockThreshold,
      janCode: schema.pantryItems.janCode,
      groupName: schema.pantryItems.groupName,
      expiresOn: schema.pantryItems.expiresOn,
    })
    .from(schema.pantryItems)
    .where(match)
    .limit(1);

  if (existing.length > 0) {
    const prev = existing[0];
    const quantity = sumQuantity(prev.quantity, options.quantity ?? null);
    const mergedExpiry = nearerExpiry(prev.expiresOn, expiresOn);
    await db
      .update(schema.pantryItems)
      .set({
        quantity,
        unit: unit ?? prev.unit,
        lowStockThreshold: options.lowStockThreshold ?? prev.lowStockThreshold,
        janCode: janCode ?? prev.janCode,
        expiresOn: mergedExpiry,
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
      groupName: prev.groupName,
      expiresOn: mergedExpiry,
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
    groupName,
    expiresOn,
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
    groupName,
    expiresOn,
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

/**
 * 在庫に今あるグループ名の一覧（未設定は含まない・名前順）。
 * チップでの絞り込みや、レシートの既定グループ選択に使う。
 */
export async function getPantryGroups(): Promise<string[]> {
  if (!isNativePlatform) return [];
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const rows = await getDb()
    .select({ groupName: schema.pantryItems.groupName })
    .from(schema.pantryItems)
    .where(eq(schema.pantryItems.familyId, await currentFamilyId()));

  const names = new Set<string>();
  for (const row of rows) if (row.groupName) names.add(row.groupName);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * レシートや手入力で品を足すときの**既定グループ**を推測する。
 *
 * 同一判定にグループが入った以上、既定を決めないと、レシートから入る品はすべて
 * 未設定バケツに落ち、既存の「〇〇の米」とは**永遠に合算されない別行**になる
 * （表記違いが重複して積まれるのと同じ形の再発）。
 *
 * 規則は素直に:**同名×同単位の既存行がちょうど 1 つならそのグループ**。
 * 無い／複数あるときは決め打ちしない（null を返し、画面で選ばせる）。
 * 推測で確定させず、確認画面で直せることが前提。
 */
export async function defaultGroupFor(name: string, unit?: string | null): Promise<string | null> {
  if (!isNativePlatform) return null;
  const normalized = normalizeItemName(name);
  if (!normalized) return null;

  const { and, eq, isNull } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const trimmedUnit = unit?.trim() ? unit.trim() : null;
  const rows = await getDb()
    .select({ groupName: schema.pantryItems.groupName })
    .from(schema.pantryItems)
    .where(
      and(
        eq(schema.pantryItems.familyId, await currentFamilyId()),
        eq(schema.pantryItems.nameNormalized, normalized),
        trimmedUnit == null
          ? isNull(schema.pantryItems.unit)
          : eq(schema.pantryItems.unit, trimmedUnit),
      ),
    )
    .limit(2);

  if (rows.length !== 1) return null;
  return rows[0].groupName ?? null;
}

/** Normalized names currently in stock (quantity null = unmanaged-but-present, or > 0). */
export async function getInStockNormalizedNames(groups?: readonly string[]): Promise<string[]> {
  if (!isNativePlatform) return [];
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const rows = await getDb()
    .select({
      nameNormalized: schema.pantryItems.nameNormalized,
      quantity: schema.pantryItems.quantity,
      groupName: schema.pantryItems.groupName,
    })
    .from(schema.pantryItems)
    .where(eq(schema.pantryItems.familyId, await currentFamilyId()));

  // グループ指定は**使うときに選ぶ**もの（グループ自身の属性にはしない）。
  // 「普段は冷蔵庫だけ、旅行前は全部」のように、そのときやりたいこと次第で変わるため。
  // 未指定 = 全グループ（従来どおり）。
  const selected = groups && groups.length > 0 ? new Set(groups) : null;
  return rows
    .filter((r) => r.quantity == null || r.quantity > 0)
    .filter((r) => (selected ? selected.has(r.groupName ?? UNGROUPED) : true))
    .map((r) => r.nameNormalized);
}

/**
 * Move a single shopping item into the pantry (買った→在庫、ワンタップ): upsert it
 * into the pantry (parsing its amount), then remove it from the shopping list.
 * Returns whether it was actually moved.
 */
export async function moveShoppingItemToPantry(item: {
  id: string;
  name: string;
  amount: string | null;
}): Promise<boolean> {
  if (!isNativePlatform) return false;
  const { removeShoppingItem } = await import('./shopping-list.service');
  const { quantity, unit } = parseAmount(item.amount);
  const result = await addPantryItem(item.name, { quantity, unit });
  if (!result) return false;
  await removeShoppingItem(item.id);
  return true;
}

/**
 * Move all checked shopping items into the pantry (買った→在庫). Returns how many
 * were moved. Retained for any items left checked from before the one-tap flow
 * (#66③) — normal use now moves each item the moment it's tapped.
 */
export async function moveCheckedShoppingItemsToPantry(): Promise<number> {
  if (!isNativePlatform) return 0;
  const { getShoppingItems } = await import('./shopping-list.service');
  const items = await getShoppingItems();
  const checked = items.filter((it) => it.checked);

  let moved = 0;
  for (const item of checked) {
    if (await moveShoppingItemToPantry(item)) moved += 1;
  }
  return moved;
}
