/**
 * 店名 → 買い物グループ の対応表（v13）。
 *
 * レシートは店名を読めるのに使っていなかった。ここに覚えておくと、次に同じ品を
 * 買い物リストへ入れるときに店を既定で埋められる。**毎回選ばせる形だと続かない**ので、
 * 初めての店名のときだけ確認して覚え、以降は自動。対応は名寄せ辞書と同じく後から直せる。
 *
 * 照合は**レシートの生の店名で完全一致**。「マックスバリュ松山店」と「マックスバリュ空港店」は
 * 別エントリになるが、どちらも同じグループ（例: スーパー）に向ければ利用者の目的には足りる。
 * チェーン名への機械的な正規化は、ルール保守が必要なうえ「スーパー」のような粗いまとめには
 * ならないので採らない。
 *
 * See docs/買い物リスト・在庫設計.md
 */
import { isNativePlatform } from '../db/client';
import { generateId } from '../utils/id';

export interface StoreGroupAlias {
  id: string;
  storeName: string;
  groupName: string;
  updatedAt: string;
}

async function currentFamilyId(): Promise<string> {
  const { getCurrentFamily } = await import('./user.service');
  return getCurrentFamily().id;
}

/** この店名に対応する買い物グループ。未登録なら null（＝初めての店） */
export async function getStoreGroupFor(storeName: string): Promise<string | null> {
  const trimmed = storeName.trim();
  if (!trimmed || !isNativePlatform) return null;

  const { and, eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const rows = await getDb()
    .select({ groupName: schema.storeGroupAliases.groupName })
    .from(schema.storeGroupAliases)
    .where(
      and(
        eq(schema.storeGroupAliases.familyId, await currentFamilyId()),
        eq(schema.storeGroupAliases.storeName, trimmed),
      ),
    )
    .limit(1);

  return rows[0]?.groupName ?? null;
}

/** 店名とグループの対応を覚える（同じ店名なら上書き＝あとから直せる） */
export async function learnStoreGroup(storeName: string, groupName: string): Promise<void> {
  const store = storeName.trim();
  const group = groupName.trim();
  if (!store || !group || !isNativePlatform) return;

  const { and, eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const familyId = await currentFamilyId();
  const now = new Date().toISOString();
  const existing = await db
    .select({ id: schema.storeGroupAliases.id })
    .from(schema.storeGroupAliases)
    .where(
      and(
        eq(schema.storeGroupAliases.familyId, familyId),
        eq(schema.storeGroupAliases.storeName, store),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.storeGroupAliases)
      .set({ groupName: group, updatedAt: now })
      .where(eq(schema.storeGroupAliases.id, existing[0].id));
    return;
  }

  await db.insert(schema.storeGroupAliases).values({
    id: generateId(),
    familyId,
    storeName: store,
    groupName: group,
    createdAt: now,
    updatedAt: now,
  });
}

/** 覚えている対応の一覧（メンテ画面用・新しい順） */
export async function getStoreGroupAliases(): Promise<StoreGroupAlias[]> {
  if (!isNativePlatform) return [];
  const { desc, eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  return getDb()
    .select({
      id: schema.storeGroupAliases.id,
      storeName: schema.storeGroupAliases.storeName,
      groupName: schema.storeGroupAliases.groupName,
      updatedAt: schema.storeGroupAliases.updatedAt,
    })
    .from(schema.storeGroupAliases)
    .where(eq(schema.storeGroupAliases.familyId, await currentFamilyId()))
    .orderBy(desc(schema.storeGroupAliases.updatedAt));
}

/** 対応を消す（次に同じ店名が出たらまた聞かれる） */
export async function deleteStoreGroupAlias(id: string): Promise<void> {
  if (!isNativePlatform) return;
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  await getDb().delete(schema.storeGroupAliases).where(eq(schema.storeGroupAliases.id, id));
}

/** 買い物リストで使われている店グループの一覧（チップ表示用・名前順） */
export async function getShoppingStoreGroups(): Promise<string[]> {
  if (!isNativePlatform) return [];
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const [items, aliases] = await Promise.all([
    getDb()
      .select({ storeGroup: schema.shoppingItems.storeGroup })
      .from(schema.shoppingItems)
      .where(eq(schema.shoppingItems.familyId, await currentFamilyId())),
    getStoreGroupAliases(),
  ]);

  const names = new Set<string>();
  for (const item of items) if (item.storeGroup) names.add(item.storeGroup);
  // 対応表にしかないグループも候補に出す（まだ品が入っていない店を選べるように）
  for (const alias of aliases) names.add(alias.groupName);
  return [...names].sort((a, b) => a.localeCompare(b));
}
