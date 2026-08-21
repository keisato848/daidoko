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
import { getCurrentUser } from './user.service';
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
  options?: { source?: ShoppingItemSource; recipeId?: string; storeGroup?: string | null },
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
    storeGroup: options?.storeGroup?.trim() ? options.storeGroup.trim() : null,
    // 誰が入れたか（v13）。同期すると「これ誰が要るって言ったの？」が起きるので記録する。
    // 列が無い間に作られた行は後から復元できないので、同期より先に記録を始める
    createdBy: getCurrentUser().id,
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
 * 「足りない材料」を買い物リストへ入れたときの内訳。
 *
 * **「在庫にある」と「もう買い物リストに入っている」を分けて数える。**
 * まとめて 0 件として返していたため、リストに入れたまま（＝まだ買っていない）
 * 材料しかないときに「すべて在庫にあります」と出て、持っていない材料を
 * 持っていることにしてしまっていた。
 */
export interface AddMissingIngredientsResult {
  /** 今回リストへ追加した数 */
  added: number;
  /** 在庫にあるので追加しなかった数 */
  alreadyInPantry: number;
  /** すでにリストに入っている（未購入）ので追加しなかった数 */
  alreadyOnList: number;
}

/** 追加結果をどう伝えるか。画面はこれを見て文言を選ぶ。 */
export type AddMissingOutcome =
  | { kind: 'added'; added: number; alreadyOnList: number }
  | { kind: 'all-on-list' }
  | { kind: 'nothing-missing' };

/**
 * 「何も追加しなかった」理由を分ける純関数。
 *
 * **リストに入れたまま（未購入）を「在庫にある」と言ってはいけない。**
 * 持っていない材料を持っていることにしてしまい、買い忘れに直結する。
 */
export function describeAddMissingResult(result: AddMissingIngredientsResult): AddMissingOutcome {
  if (result.added > 0) {
    return { kind: 'added', added: result.added, alreadyOnList: result.alreadyOnList };
  }
  if (result.alreadyOnList > 0) return { kind: 'all-on-list' };
  return { kind: 'nothing-missing' };
}

/**
 * Add only the recipe's ingredients NOT currently in the pantry (足りない材料).
 * With an empty pantry this equals addRecipeIngredientsToList.
 */
export async function addMissingRecipeIngredientsToList(
  recipeId: string,
): Promise<AddMissingIngredientsResult> {
  const empty: AddMissingIngredientsResult = { added: 0, alreadyInPantry: 0, alreadyOnList: 0 };
  if (!isNativePlatform) return empty;
  const detail = await getRecipeDetail(recipeId);
  if (!detail) return empty;

  const { getInStockNormalizedNames } = await import('./pantry.service');
  const { getAliasMap } = await import('./name-alias.service');
  const { normalizeItemName } = await import('../utils/itemName');
  const [pantryNames, currentAliases] = await Promise.all([
    getInStockNormalizedNames(),
    getAliasMap(),
  ]);
  let aliases = currentAliases;

  // 「足りない材料」は在庫とレシピ材料の突合そのもの。**ここでも辞書を育てる**
  // （cookable 画面を開かないと辞書が空のままだったのが名寄せが効かない原因だった。
  //  docs/買い物リスト・在庫設計.md §6）。投げるのはルールで当たらなかった材料だけで、
  //  枠切れ・オフラインは黙って素通しして従来どおり動く。
  const unresolved = detail.ingredients
    .map((ingredient) => normalizeItemName(ingredient.name))
    .filter((name) => name && !isInStock(name, pantryNames, aliases));
  if (unresolved.length > 0) {
    const { resolveNames } = await import('./name-resolve.service');
    const resolved = await resolveNames(unresolved).catch(() => null);
    if (resolved && resolved.resolved > 0) aliases = await getAliasMap();
  }

  const result: AddMissingIngredientsResult = { added: 0, alreadyInPantry: 0, alreadyOnList: 0 };
  for (const ingredient of detail.ingredients) {
    if (isInStock(ingredient.name, pantryNames, aliases)) {
      result.alreadyInPantry += 1;
      continue;
    }
    const inserted = await addShoppingItem(ingredient.name, ingredient.amount ?? undefined, {
      source: 'recipe',
      recipeId,
    });
    // addShoppingItem が null を返すのは「同じ名前が未購入で並んでいる」ときだけ
    if (inserted) result.added += 1;
    else result.alreadyOnList += 1;
  }
  return result;
}

/** レシート消し込みの結果。確認画面に「◯件を消し込みます」と出すために名前も返す。 */
export interface CheckOffResult {
  count: number;
  names: string[];
}

/**
 * 買った品を買い物リストから**消し込む**（レシート取り込みから呼ぶ）。
 *
 * 決めごと:
 * - **消さずにチェックを付ける。** 誤照合で行が消えると気づけないが、チェックなら取り消せる
 * - **照合は品目名（正規化＋名寄せ辞書）だけ。** 店（`store_group`）は表示の絞り込み専用で、
 *   照合には使わない — 同じ品を別の店で買うことは普通にあり、店で絞ると取りこぼす
 * - **数量は不問。** 「牛乳2本」必要で1本だけ買った場合もチェックは付く（外すのは利用者の判断）
 * - 対象は**未チェックの行だけ**
 */
export async function checkOffByNames(boughtNames: readonly string[]): Promise<CheckOffResult> {
  const empty: CheckOffResult = { count: 0, names: [] };
  if (!isNativePlatform || boughtNames.length === 0) return empty;

  const { and, eq, inArray } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const { getAliasMap } = await import('./name-alias.service');
  const { itemNamesMatch } = await import('../utils/itemMatch');
  const db = getDb();

  const familyId = await currentFamilyId();
  const [pending, aliases] = await Promise.all([
    db
      .select({
        id: schema.shoppingItems.id,
        name: schema.shoppingItems.name,
        nameNormalized: schema.shoppingItems.nameNormalized,
      })
      .from(schema.shoppingItems)
      .where(and(eq(schema.shoppingItems.familyId, familyId), eq(schema.shoppingItems.checked, 0))),
    getAliasMap(),
  ]);
  if (pending.length === 0) return empty;

  const bought = boughtNames.map((name) => normalizeItemName(name)).filter(Boolean);
  const hit = pending.filter((item) =>
    bought.some((name) => itemNamesMatch(item.nameNormalized, name, aliases)),
  );
  if (hit.length === 0) return empty;

  const now = new Date().toISOString();
  await db
    .update(schema.shoppingItems)
    .set({ checked: 1, checkedAt: now, checkedBy: getCurrentUser().id })
    .where(
      inArray(
        schema.shoppingItems.id,
        hit.map((item) => item.id),
      ),
    );
  return { count: hit.length, names: hit.map((item) => item.name) };
}

export async function removeShoppingItem(id: string): Promise<void> {
  if (!isNativePlatform) return;
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  await getDb().delete(schema.shoppingItems).where(eq(schema.shoppingItems.id, id));
}
