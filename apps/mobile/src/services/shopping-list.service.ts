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
import { SYNC_ENTITY_SHOPPING_ITEM } from './sync-payload';
import { enqueueSyncEntity, initialSharedValue } from './sync-queue.service';
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
  storeGroup?: string | null;
  createdBy?: string | null;
  checkedBy?: string | null;
  shared?: number | null;
}

function rowToItem(row: ShoppingRow): ShoppingItem {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    checked: row.checked === 1,
    source: row.source as ShoppingItemSource,
    recipeId: row.recipeId,
    storeGroup: row.storeGroup ?? null,
    createdBy: row.createdBy ?? null,
    checkedBy: row.checkedBy ?? null,
    // null は「共有」— 列を持たない古い行を現行どおりに見せる（設計 §5-2b）
    shared: row.shared !== 0,
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
      storeGroup: schema.shoppingItems.storeGroup,
      createdBy: schema.shoppingItems.createdBy,
      checkedBy: schema.shoppingItems.checkedBy,
      shared: schema.shoppingItems.shared,
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
    // 同期の LWW の基準（v15）。**全書き込み経路でセットすること** —
    // ここが古いままだと、他端末の古い変更に負けて変更が消える
    updatedAt: new Date().toISOString(),
    // 参加中なら「共有すると決まっている」1。未参加なら null（参加時に聞く）
    shared: await initialSharedValue(),
  });

  await enqueueSyncEntity(SYNC_ENTITY_SHOPPING_ITEM, id);

  return {
    id,
    name: trimmed,
    amount: amountValue,
    checked: false,
    source,
    recipeId: options?.recipeId ?? null,
    storeGroup: options?.storeGroup?.trim() ? options.storeGroup.trim() : null,
    createdBy: getCurrentUser().id,
    checkedBy: null,
    shared: true,
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

/**
 * 買い物リストの未チェック行のうち、買った品と当たるものを返す（**書き込まない**）。
 * レシート確認画面で「◯件を消し込みます」と先に見せるために、照合だけ切り出してある。
 */
export async function matchPendingByNames(
  boughtNames: readonly string[],
): Promise<{ id: string; name: string }[]> {
  if (!isNativePlatform || boughtNames.length === 0) return [];

  const { and, eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const { getAliasMap } = await import('./name-alias.service');
  const { itemNamesMatch } = await import('../utils/itemMatch');

  const familyId = await currentFamilyId();
  const [pending, aliases] = await Promise.all([
    getDb()
      .select({
        id: schema.shoppingItems.id,
        name: schema.shoppingItems.name,
        nameNormalized: schema.shoppingItems.nameNormalized,
      })
      .from(schema.shoppingItems)
      .where(and(eq(schema.shoppingItems.familyId, familyId), eq(schema.shoppingItems.checked, 0))),
    getAliasMap(),
  ]);
  if (pending.length === 0) return [];

  const bought = boughtNames.map((name) => normalizeItemName(name)).filter(Boolean);
  return pending
    .filter((item) => bought.some((name) => itemNamesMatch(item.nameNormalized, name, aliases)))
    .map((item) => ({ id: item.id, name: item.name }));
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
  const hit = await matchPendingByNames(boughtNames);
  if (hit.length === 0) return empty;

  const { inArray } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const now = new Date().toISOString();
  const updated = await db
    .update(schema.shoppingItems)
    .set({ checked: 1, checkedAt: now, checkedBy: getCurrentUser().id, updatedAt: now })
    .where(
      inArray(
        schema.shoppingItems.id,
        hit.map((item) => item.id),
      ),
    )
    .returning({ id: schema.shoppingItems.id, shared: schema.shoppingItems.shared });
  for (const row of updated) {
    await enqueueIfShared(row.id, row.shared);
  }
  return { count: hit.length, names: hit.map((item) => item.name) };
}

/**
 * チェックを付ける・外す。レシートの消し込みを**取り消せる**ようにするために要る
 * （誤照合で消えたままだと買い忘れる）。
 */
export async function setShoppingItemChecked(id: string, checked: boolean): Promise<void> {
  if (!isNativePlatform) return;
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const now = new Date().toISOString();
  const updated = await getDb()
    .update(schema.shoppingItems)
    .set(
      checked
        ? { checked: 1, checkedAt: now, checkedBy: getCurrentUser().id, updatedAt: now }
        : { checked: 0, checkedAt: null, checkedBy: null, updatedAt: now },
    )
    .where(eq(schema.shoppingItems.id, id))
    .returning({ shared: schema.shoppingItems.shared });

  await enqueueIfShared(id, updated[0]?.shared);
}

/** 買う場所を変える（空文字・null は未設定に戻す） */
export async function setShoppingItemStore(id: string, storeGroup: string | null): Promise<void> {
  if (!isNativePlatform) return;
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const updated = await getDb()
    .update(schema.shoppingItems)
    .set({
      storeGroup: storeGroup?.trim() ? storeGroup.trim() : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.shoppingItems.id, id))
    .returning({ shared: schema.shoppingItems.shared });

  await enqueueIfShared(id, updated[0]?.shared);
}

/**
 * 共有中の行だけ送信待ちへ積む。
 *
 * **「自分だけ」の行は触るたびに積まない。** 積むと毎回 tombstone がサーバーへ出て、
 * そのたびに家族の端末へ変更通知が飛ぶ（中身は固定文言だが「何かしている」ことが
 * 伝わる）。共有をやめた瞬間の 1 回（`setShoppingItemShared`）で他端末からは消えているので、
 * それ以降の編集・削除は端末の中だけで完結してよい。
 */
async function enqueueIfShared(id: string, shared: number | null | undefined): Promise<void> {
  if (shared === 0) return;
  await enqueueSyncEntity(SYNC_ENTITY_SHOPPING_ITEM, id);
}

/**
 * この品目を家族と共有するか（設計 §5-2）。
 *
 * 共有をやめると、次の同期で**他端末からも消える**（tombstone を送る）。
 * 自分の端末には残るので「自分だけの買い物」に戻るだけ。
 */
export async function setShoppingItemShared(id: string, shared: boolean): Promise<void> {
  if (!isNativePlatform) return;
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  await getDb()
    .update(schema.shoppingItems)
    .set({ shared: shared ? 1 : 0, updatedAt: new Date().toISOString() })
    .where(eq(schema.shoppingItems.id, id));

  await enqueueSyncEntity(SYNC_ENTITY_SHOPPING_ITEM, id);
}

/**
 * いまある買い物リストを一括で共有する/しない（グループ参加直後に一度だけ聞く）。
 * 変更した件数を返す。
 */
/**
 * まだ決めていない品目（`shared IS NULL`）だけを一括で共有する/しない。
 *
 * **「全部」ではなく「まだ決めていないもの」だけ**を触るのが要点。参加プロンプトの
 * 対象は「この端末が自分で作って、まだ共有可否を決めていない品目」であって、
 * 他端末から降りてきた品目ではない。全部を倒すと、降りてきたばかりの家族の品目まで
 * `shared = 0` になり、墓標として押し返して**家族の端末から消してしまう**
 * （実機検証 2026-08-22 で再現）。離脱→再参加でも同じことが起きる。
 *
 * 新しく作った行は `shared` が NULL（＝共有）なので、次に聞かれたときの対象になる。
 */
export async function setUndecidedShoppingItemsShared(shared: boolean): Promise<string[]> {
  if (!isNativePlatform) return [];
  const { isNull } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const rows = await db
    .select({ id: schema.shoppingItems.id })
    .from(schema.shoppingItems)
    .where(isNull(schema.shoppingItems.shared));
  if (rows.length === 0) return [];

  const now = new Date().toISOString();
  await db
    .update(schema.shoppingItems)
    .set({ shared: shared ? 1 : 0, updatedAt: now })
    .where(isNull(schema.shoppingItems.shared));
  // **積まない。** 呼ばれるのは参加より前だけ（`family.tsx` の参加プロンプト）。
  // ここで積むと 3 秒デバウンスが参加の往復中に発火し、「自分だけ」にしたばかりの
  // 品目の id が墓標としてサーバーへ出る。参加時に `onSyncGroupJoined` が
  // 待ち行列を捨てて全件積み直すので、ここでの積み直しは要らない。
  return rows.map((row) => row.id);
}

/**
 * 参加プロンプトの答えを**無かったことにする**（参加・作成がその後に失敗したとき）。
 *
 * 答えは参加より先に書くので、参加が失敗すると決定だけが残る。残ると次に参加したとき
 * プロンプトが出ず（まだ決めていない行が 0 件）、「自分だけ」にした品目は永久に
 * 同期されない・「共有する」にした品目は別のグループへ無確認で出る。
 * この時点では資格情報が無く一度もサーバーへ出ていないので、戻して安全。
 */
export async function revertUndecidedShoppingItemsShared(ids: readonly string[]): Promise<void> {
  if (!isNativePlatform || ids.length === 0) return;
  const { inArray } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  await getDb()
    .update(schema.shoppingItems)
    .set({ shared: null, updatedAt: new Date().toISOString() })
    .where(inArray(schema.shoppingItems.id, [...ids]));
}

/** 参加プロンプトを出すかの判定用。まだ決めていない品目の数 */
export async function countUndecidedSharedShoppingItems(): Promise<number> {
  if (!isNativePlatform) return 0;
  const { isNull } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const rows = await getDb()
    .select({ id: schema.shoppingItems.id })
    .from(schema.shoppingItems)
    .where(isNull(schema.shoppingItems.shared));
  return rows.length;
}

export async function removeShoppingItem(id: string): Promise<void> {
  if (!isNativePlatform) return;
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const removed = await getDb()
    .delete(schema.shoppingItems)
    .where(eq(schema.shoppingItems.id, id))
    .returning({ shared: schema.shoppingItems.shared });
  // 物理削除。送信時に行が無いことを見て tombstone になる（sync-row-entities.service）。
  // 「自分だけ」だった行は他端末にもサーバーにも（墓標として以外）無いので積まない
  await enqueueIfShared(id, removed[0]?.shared);
}
