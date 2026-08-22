/**
 * 買い物・在庫・辞書の DB ⇄ payload 変換（S2-A — `docs/クラウド同期設計.md` §5-2b）。
 *
 * レシピ（`sync-entities.service.ts`）と違って**1 行で完結する**種別だけを扱う。
 * 子テーブルも写真も無いので、組み立ても適用も「行 1 つ」で済む。
 * S1 のファイルを太らせないために分けてあり、`sync-entities.service.ts` から呼ばれる。
 *
 * この種別に固有の約束:
 *
 * 1. **`shared = 0` は tombstone として送る。** 「行が消えた」と「共有をやめた」を
 *    同じ形で扱う。enqueue 側で弾くと、共有をやめた瞬間の行は既に 0 なので
 *    **送られず他端末に残り続ける**（設計 §5-2b）
 * 2. **`shared` は payload に入れない。** サーバーに行があること自体が「共有中」を意味する
 * 3. **辞書系（名寄せ・JAN・店名）は id ではなく自然キーで引き当てる。**
 *    `(family_id, …)` の UNIQUE 索引があるので、id で upsert すると
 *    「同じ『たまご→卵』を両端末が別 id で持っている」だけで一意制約に当たる
 * 4. `shopping_items.updated_at` は v15 で足した nullable 列。**null なら
 *    `checked_at ?? created_at` を代用する**（古い行・古いバックアップからの復元）
 */
import { and, eq } from 'drizzle-orm';

import { getDb } from '../db/client';
import * as schema from '../db/schema';
import {
  SYNC_ENTITY_JAN_CATALOG,
  SYNC_ENTITY_NAME_ALIAS,
  SYNC_ENTITY_PANTRY_ITEM,
  SYNC_ENTITY_SHOPPING_ITEM,
  SYNC_ENTITY_STORE_GROUP_ALIAS,
  SYNC_PAYLOAD_SCHEMA_VERSION,
  incomingChangeWins,
  serializeSyncPayload,
  type RowSyncPayload,
  type SyncEntityType,
} from './sync-payload';
import type { ApplyOutcome, OutgoingChange, OutgoingChangeResult } from './sync-entities.service';

/** 全端末で同じ固定値（`recipe.service.ts` と揃える） */
const FAMILY_ID = 'family-001';

/** この種別か（`sync-entities.service.ts` の分岐で使う） */
export function isRowEntityType(entityType: string): boolean {
  return (
    entityType === SYNC_ENTITY_SHOPPING_ITEM ||
    entityType === SYNC_ENTITY_PANTRY_ITEM ||
    entityType === SYNC_ENTITY_NAME_ALIAS ||
    entityType === SYNC_ENTITY_JAN_CATALOG ||
    entityType === SYNC_ENTITY_STORE_GROUP_ALIAS
  );
}

/** 共有されているか。**null は「共有」**（列を持たない古い行を現行どおりに見せる） */
function isShared(shared: number | null): boolean {
  return shared !== 0;
}

/** 買い物の最終更新。v15 前の行は null なので、一番近い時刻で代用する */
function shoppingUpdatedAt(row: {
  updatedAt: string | null;
  checkedAt: string | null;
  createdAt: string;
}): string {
  return row.updatedAt ?? row.checkedAt ?? row.createdAt;
}

function tombstone(entityType: string, entityId: string, deletedAt: string): OutgoingChange {
  return { entityType, entityId, payload: null, clientUpdatedAt: deletedAt, deleted: true };
}

// ── 送信: DB → payload ───────────────────────────────────────────────────────

async function buildShoppingItemChange(id: string, deletedAt: string): Promise<OutgoingChange> {
  const rows = await getDb()
    .select()
    .from(schema.shoppingItems)
    .where(eq(schema.shoppingItems.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return tombstone(SYNC_ENTITY_SHOPPING_ITEM, id, deletedAt);

  const updatedAt = shoppingUpdatedAt(row);
  // 共有をやめた行は「他端末から消す」= tombstone。時刻は行の最終更新を使う
  if (!isShared(row.shared)) return tombstone(SYNC_ENTITY_SHOPPING_ITEM, id, updatedAt);

  return {
    entityType: SYNC_ENTITY_SHOPPING_ITEM,
    entityId: id,
    payload: serializeSyncPayload({
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: SYNC_ENTITY_SHOPPING_ITEM,
      item: {
        id: row.id,
        name: row.name,
        nameNormalized: row.nameNormalized,
        amount: row.amount,
        checked: row.checked,
        source: row.source,
        sortOrder: row.sortOrder,
        storeGroup: row.storeGroup,
        createdAt: row.createdAt,
        checkedAt: row.checkedAt,
        updatedAt,
      },
    }),
    clientUpdatedAt: updatedAt,
    deleted: false,
  };
}

async function buildPantryItemChange(id: string, deletedAt: string): Promise<OutgoingChange> {
  const rows = await getDb()
    .select()
    .from(schema.pantryItems)
    .where(eq(schema.pantryItems.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return tombstone(SYNC_ENTITY_PANTRY_ITEM, id, deletedAt);
  if (!isShared(row.shared)) return tombstone(SYNC_ENTITY_PANTRY_ITEM, id, row.updatedAt);

  return {
    entityType: SYNC_ENTITY_PANTRY_ITEM,
    entityId: id,
    payload: serializeSyncPayload({
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: SYNC_ENTITY_PANTRY_ITEM,
      item: {
        id: row.id,
        name: row.name,
        nameNormalized: row.nameNormalized,
        quantity: row.quantity,
        unit: row.unit,
        lowStockThreshold: row.lowStockThreshold,
        janCode: row.janCode,
        groupName: row.groupName,
        expiresOn: row.expiresOn,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    }),
    clientUpdatedAt: row.updatedAt,
    deleted: false,
  };
}

async function buildNameAliasChange(id: string, deletedAt: string): Promise<OutgoingChange> {
  const rows = await getDb()
    .select()
    .from(schema.nameAliases)
    .where(eq(schema.nameAliases.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return tombstone(SYNC_ENTITY_NAME_ALIAS, id, deletedAt);

  return {
    entityType: SYNC_ENTITY_NAME_ALIAS,
    entityId: id,
    payload: serializeSyncPayload({
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: SYNC_ENTITY_NAME_ALIAS,
      item: {
        id: row.id,
        sourceNormalized: row.sourceNormalized,
        canonical: row.canonical,
        updatedAt: row.updatedAt,
      },
    }),
    clientUpdatedAt: row.updatedAt,
    deleted: false,
  };
}

async function buildJanCatalogChange(id: string, deletedAt: string): Promise<OutgoingChange> {
  const rows = await getDb()
    .select()
    .from(schema.janCatalog)
    .where(eq(schema.janCatalog.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return tombstone(SYNC_ENTITY_JAN_CATALOG, id, deletedAt);

  return {
    entityType: SYNC_ENTITY_JAN_CATALOG,
    entityId: id,
    payload: serializeSyncPayload({
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: SYNC_ENTITY_JAN_CATALOG,
      item: {
        id: row.id,
        janCode: row.janCode,
        name: row.name,
        unit: row.unit,
        updatedAt: row.updatedAt,
      },
    }),
    clientUpdatedAt: row.updatedAt,
    deleted: false,
  };
}

async function buildStoreGroupAliasChange(id: string, deletedAt: string): Promise<OutgoingChange> {
  const rows = await getDb()
    .select()
    .from(schema.storeGroupAliases)
    .where(eq(schema.storeGroupAliases.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return tombstone(SYNC_ENTITY_STORE_GROUP_ALIAS, id, deletedAt);

  return {
    entityType: SYNC_ENTITY_STORE_GROUP_ALIAS,
    entityId: id,
    payload: serializeSyncPayload({
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: SYNC_ENTITY_STORE_GROUP_ALIAS,
      item: {
        id: row.id,
        storeName: row.storeName,
        groupName: row.groupName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    }),
    clientUpdatedAt: row.updatedAt,
    deleted: false,
  };
}

/** 送信 1 件分を組み立てる（この種別のみ。呼び出し側で種別を絞ってから呼ぶ） */
export async function buildRowOutgoingChange(
  entityType: string,
  entityId: string,
  deletedAt: string,
): Promise<OutgoingChangeResult> {
  try {
    switch (entityType) {
      case SYNC_ENTITY_SHOPPING_ITEM:
        return { kind: 'change', change: await buildShoppingItemChange(entityId, deletedAt) };
      case SYNC_ENTITY_PANTRY_ITEM:
        return { kind: 'change', change: await buildPantryItemChange(entityId, deletedAt) };
      case SYNC_ENTITY_NAME_ALIAS:
        return { kind: 'change', change: await buildNameAliasChange(entityId, deletedAt) };
      case SYNC_ENTITY_JAN_CATALOG:
        return { kind: 'change', change: await buildJanCatalogChange(entityId, deletedAt) };
      case SYNC_ENTITY_STORE_GROUP_ALIAS:
        return { kind: 'change', change: await buildStoreGroupAliasChange(entityId, deletedAt) };
      default:
        return { kind: 'unsupported' };
    }
  } catch {
    // 一時的な失敗。**捨てずに待ち行列へ残す**
    return { kind: 'error' };
  }
}

/** グループ参加時の全件積み直し用。**共有していない行は積まない** */
export async function listRowSyncableEntities(): Promise<
  { entityType: SyncEntityType; entityId: string }[]
> {
  const db = getDb();
  const [shopping, pantry, aliases, jan, storeGroups] = await Promise.all([
    db
      .select({ id: schema.shoppingItems.id, shared: schema.shoppingItems.shared })
      .from(schema.shoppingItems),
    db
      .select({ id: schema.pantryItems.id, shared: schema.pantryItems.shared })
      .from(schema.pantryItems),
    db.select({ id: schema.nameAliases.id }).from(schema.nameAliases),
    db.select({ id: schema.janCatalog.id }).from(schema.janCatalog),
    db.select({ id: schema.storeGroupAliases.id }).from(schema.storeGroupAliases),
  ]);

  return [
    ...shopping
      .filter((row) => isShared(row.shared))
      .map((row) => ({ entityType: SYNC_ENTITY_SHOPPING_ITEM, entityId: row.id }) as const),
    ...pantry
      .filter((row) => isShared(row.shared))
      .map((row) => ({ entityType: SYNC_ENTITY_PANTRY_ITEM, entityId: row.id }) as const),
    ...aliases.map((row) => ({ entityType: SYNC_ENTITY_NAME_ALIAS, entityId: row.id }) as const),
    ...jan.map((row) => ({ entityType: SYNC_ENTITY_JAN_CATALOG, entityId: row.id }) as const),
    ...storeGroups.map(
      (row) => ({ entityType: SYNC_ENTITY_STORE_GROUP_ALIAS, entityId: row.id }) as const,
    ),
  ];
}

// ── 受信: payload → DB ──────────────────────────────────────────────────────

async function applyShoppingItem(payload: RowSyncPayload): Promise<ApplyOutcome> {
  if (payload.entity !== SYNC_ENTITY_SHOPPING_ITEM) return 'skipped';
  const db = getDb();
  const item = payload.item;
  const localRows = await db
    .select({
      updatedAt: schema.shoppingItems.updatedAt,
      checkedAt: schema.shoppingItems.checkedAt,
      createdAt: schema.shoppingItems.createdAt,
    })
    .from(schema.shoppingItems)
    .where(eq(schema.shoppingItems.id, item.id))
    .limit(1);
  const local = localRows[0];
  if (local && !incomingChangeWins(item.updatedAt, shoppingUpdatedAt(local))) return 'skipped';

  await db
    .insert(schema.shoppingItems)
    .values({
      id: item.id,
      familyId: FAMILY_ID,
      name: item.name,
      nameNormalized: item.nameNormalized,
      amount: item.amount,
      checked: item.checked,
      source: item.source,
      recipeId: null, // 受信側に無いレシピを指すと外部キーで落ちる（設計 §5-2b）
      sortOrder: item.sortOrder,
      storeGroup: item.storeGroup,
      createdBy: null,
      checkedBy: null,
      createdAt: item.createdAt,
      checkedAt: item.checkedAt,
      updatedAt: item.updatedAt,
      shared: 1, // 届いた＝共有されている
    })
    .onConflictDoUpdate({
      target: schema.shoppingItems.id,
      set: {
        name: item.name,
        nameNormalized: item.nameNormalized,
        amount: item.amount,
        checked: item.checked,
        source: item.source,
        sortOrder: item.sortOrder,
        storeGroup: item.storeGroup,
        checkedAt: item.checkedAt,
        updatedAt: item.updatedAt,
        shared: 1,
      },
    });
  return 'applied';
}

async function applyPantryItem(payload: RowSyncPayload): Promise<ApplyOutcome> {
  if (payload.entity !== SYNC_ENTITY_PANTRY_ITEM) return 'skipped';
  const db = getDb();
  const item = payload.item;
  const localRows = await db
    .select({ updatedAt: schema.pantryItems.updatedAt })
    .from(schema.pantryItems)
    .where(eq(schema.pantryItems.id, item.id))
    .limit(1);
  const local = localRows[0];
  if (local && !incomingChangeWins(item.updatedAt, local.updatedAt)) return 'skipped';

  await db
    .insert(schema.pantryItems)
    .values({
      id: item.id,
      familyId: FAMILY_ID,
      name: item.name,
      nameNormalized: item.nameNormalized,
      quantity: item.quantity,
      unit: item.unit,
      lowStockThreshold: item.lowStockThreshold,
      janCode: item.janCode,
      groupName: item.groupName,
      expiresOn: item.expiresOn,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      shared: 1,
    })
    .onConflictDoUpdate({
      target: schema.pantryItems.id,
      set: {
        name: item.name,
        nameNormalized: item.nameNormalized,
        quantity: item.quantity,
        unit: item.unit,
        lowStockThreshold: item.lowStockThreshold,
        janCode: item.janCode,
        groupName: item.groupName,
        expiresOn: item.expiresOn,
        updatedAt: item.updatedAt,
        shared: 1,
      },
    });
  return 'applied';
}

/**
 * 辞書系の適用。**id ではなく自然キーで引き当てる。**
 *
 * 同じ対応（「たまご→卵」）を両端末が別 id で持っているのが普通なので、id で upsert すると
 * `(family_id, source_normalized)` の一意制約に当たる。自然キーで見つけて中身だけ
 * 更新すれば、id は端末ごとに違ったままでも**中身は収束する**。
 */
async function applyNameAlias(payload: RowSyncPayload): Promise<ApplyOutcome> {
  if (payload.entity !== SYNC_ENTITY_NAME_ALIAS) return 'skipped';
  const db = getDb();
  const item = payload.item;
  const rows = await db
    .select({ id: schema.nameAliases.id, updatedAt: schema.nameAliases.updatedAt })
    .from(schema.nameAliases)
    .where(
      and(
        eq(schema.nameAliases.familyId, FAMILY_ID),
        eq(schema.nameAliases.sourceNormalized, item.sourceNormalized),
      ),
    )
    .limit(1);
  const local = rows[0];
  if (local) {
    if (!incomingChangeWins(item.updatedAt, local.updatedAt)) return 'skipped';
    await db
      .update(schema.nameAliases)
      .set({ canonical: item.canonical, updatedAt: item.updatedAt })
      .where(eq(schema.nameAliases.id, local.id));
    return 'applied';
  }
  await db.insert(schema.nameAliases).values({
    id: item.id,
    familyId: FAMILY_ID,
    sourceNormalized: item.sourceNormalized,
    canonical: item.canonical,
    updatedAt: item.updatedAt,
  });
  return 'applied';
}

async function applyJanCatalog(payload: RowSyncPayload): Promise<ApplyOutcome> {
  if (payload.entity !== SYNC_ENTITY_JAN_CATALOG) return 'skipped';
  const db = getDb();
  const item = payload.item;
  const rows = await db
    .select({ id: schema.janCatalog.id, updatedAt: schema.janCatalog.updatedAt })
    .from(schema.janCatalog)
    .where(
      and(eq(schema.janCatalog.familyId, FAMILY_ID), eq(schema.janCatalog.janCode, item.janCode)),
    )
    .limit(1);
  const local = rows[0];
  if (local) {
    if (!incomingChangeWins(item.updatedAt, local.updatedAt)) return 'skipped';
    await db
      .update(schema.janCatalog)
      .set({ name: item.name, unit: item.unit, updatedAt: item.updatedAt })
      .where(eq(schema.janCatalog.id, local.id));
    return 'applied';
  }
  await db.insert(schema.janCatalog).values({
    id: item.id,
    familyId: FAMILY_ID,
    janCode: item.janCode,
    name: item.name,
    unit: item.unit,
    updatedAt: item.updatedAt,
  });
  return 'applied';
}

async function applyStoreGroupAlias(payload: RowSyncPayload): Promise<ApplyOutcome> {
  if (payload.entity !== SYNC_ENTITY_STORE_GROUP_ALIAS) return 'skipped';
  const db = getDb();
  const item = payload.item;
  const rows = await db
    .select({ id: schema.storeGroupAliases.id, updatedAt: schema.storeGroupAliases.updatedAt })
    .from(schema.storeGroupAliases)
    .where(
      and(
        eq(schema.storeGroupAliases.familyId, FAMILY_ID),
        eq(schema.storeGroupAliases.storeName, item.storeName),
      ),
    )
    .limit(1);
  const local = rows[0];
  if (local) {
    if (!incomingChangeWins(item.updatedAt, local.updatedAt)) return 'skipped';
    await db
      .update(schema.storeGroupAliases)
      .set({ groupName: item.groupName, updatedAt: item.updatedAt })
      .where(eq(schema.storeGroupAliases.id, local.id));
    return 'applied';
  }
  await db.insert(schema.storeGroupAliases).values({
    id: item.id,
    familyId: FAMILY_ID,
    storeName: item.storeName,
    groupName: item.groupName,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
  return 'applied';
}

export async function applyRowPayload(payload: RowSyncPayload): Promise<ApplyOutcome> {
  switch (payload.entity) {
    case SYNC_ENTITY_SHOPPING_ITEM:
      return applyShoppingItem(payload);
    case SYNC_ENTITY_PANTRY_ITEM:
      return applyPantryItem(payload);
    case SYNC_ENTITY_NAME_ALIAS:
      return applyNameAlias(payload);
    case SYNC_ENTITY_JAN_CATALOG:
      return applyJanCatalog(payload);
    case SYNC_ENTITY_STORE_GROUP_ALIAS:
      return applyStoreGroupAlias(payload);
    default:
      return 'skipped';
  }
}

/**
 * 受信 tombstone。**物理削除**（買い物・在庫・辞書はどれも子を持たないので安全）。
 *
 * 辞書系で「持っていない id」の tombstone が来たら何もしない。自然キーで持っている
 * 同じ対応が消えずに残るが、**消えるより残る方が害が小さい**（削除は稀で、
 * 残っても名寄せが効くだけ）。
 */
export async function applyRowTombstone(
  entityType: string,
  entityId: string,
  clientUpdatedAt: string,
): Promise<ApplyOutcome> {
  const db = getDb();
  switch (entityType) {
    case SYNC_ENTITY_SHOPPING_ITEM: {
      const rows = await db
        .select({
          updatedAt: schema.shoppingItems.updatedAt,
          checkedAt: schema.shoppingItems.checkedAt,
          createdAt: schema.shoppingItems.createdAt,
        })
        .from(schema.shoppingItems)
        .where(eq(schema.shoppingItems.id, entityId))
        .limit(1);
      const local = rows[0];
      if (!local) return 'skipped';
      if (!incomingChangeWins(clientUpdatedAt, shoppingUpdatedAt(local))) return 'skipped';
      await db.delete(schema.shoppingItems).where(eq(schema.shoppingItems.id, entityId));
      return 'applied';
    }
    case SYNC_ENTITY_PANTRY_ITEM: {
      const rows = await db
        .select({ updatedAt: schema.pantryItems.updatedAt })
        .from(schema.pantryItems)
        .where(eq(schema.pantryItems.id, entityId))
        .limit(1);
      const local = rows[0];
      if (!local) return 'skipped';
      if (!incomingChangeWins(clientUpdatedAt, local.updatedAt)) return 'skipped';
      await db.delete(schema.pantryItems).where(eq(schema.pantryItems.id, entityId));
      return 'applied';
    }
    case SYNC_ENTITY_NAME_ALIAS:
      await db.delete(schema.nameAliases).where(eq(schema.nameAliases.id, entityId));
      return 'applied';
    case SYNC_ENTITY_JAN_CATALOG:
      await db.delete(schema.janCatalog).where(eq(schema.janCatalog.id, entityId));
      return 'applied';
    case SYNC_ENTITY_STORE_GROUP_ALIAS:
      await db.delete(schema.storeGroupAliases).where(eq(schema.storeGroupAliases.id, entityId));
      return 'applied';
    default:
      return 'skipped';
  }
}
