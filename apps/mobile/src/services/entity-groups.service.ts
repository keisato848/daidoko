/**
 * 実体のグループ所属（entity_groups）と多グループの文脈（G-2a —
 * `docs/クラウド同期設計.md` §12-3 / `docs/共有設計.md` §5-4）。
 *
 * ここは **DB（entity_groups・app_meta）を掴む側**。判断（既定所属を付けてよいか・
 * ファンアウトの分配・カーソル鍵）はすべて `sync-payload.ts` の純関数に寄せてある
 * （DB を掴む経路は jest で叩けない — `docs/品質基準.md` §2.3）。
 *
 * 約束:
 * - **例外を上に投げない。** 所属の記録に失敗しても、レシピ保存や同期そのものを
 *   止めない（呼び出し側の sync-runner は失敗時に従来の単一グループ経路へ倒れる）
 * - 所属の初期化（§12-4 G7）は一度きりのバックフィル。完了フラグは app_meta の
 *   `sync_entity_groups_migrated`。**完了するまで push のファンアウトは使わない**
 *   （所属が空なだけの実体を「自分だけ」と誤読して送信待ちを捨てないため）
 */
import { eq, inArray } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { listAllSyncableEntities } from './sync-entities.service';
import { getStoredCredentials, listSyncGroups } from './sync-client.service';
import {
  SYNC_ENTITY_JAN_CATALOG,
  SYNC_ENTITY_NAME_ALIAS,
  SYNC_ENTITY_PANTRY_ITEM,
  SYNC_ENTITY_PANTRY_QUANTITY,
  SYNC_ENTITY_RECIPE,
  SYNC_ENTITY_RECIPE_BOOK,
  SYNC_ENTITY_SHOPPING_ITEM,
  SYNC_ENTITY_STORE_GROUP_ALIAS,
  entityGroupKeyOf,
  entityGroupMapKey,
  resolveCurrentGroupId,
  shouldAssignDefaultGroup,
  type EntityGroupKey,
} from './sync-payload';
import { listSyncQueue } from './sync-queue.service';

/** 所属バックフィル（§12-4）の完了フラグ。'1' = 完了 */
const ENTITY_GROUPS_MIGRATED_KEY = 'sync_entity_groups_migrated';
/** 「現在のグループ」（G2 の既定所属先）。未設定なら主グループ */
const CURRENT_GROUP_KEY = 'sync_current_group';
/** 参加グループ一覧のローカル控え（JSON 配列）。正はサーバーの GET /sync/me/groups */
const KNOWN_GROUPS_KEY = 'sync_known_groups';

/** バックフィルの INSERT をまとめる単位（SQLite の変数上限 999 に収まる幅） */
const INSERT_CHUNK = 100;

// ── 参加グループの控えと「現在のグループ」 ──────────────────────────────────

/**
 * この端末が参加しているとローカルで分かっているグループ。**主グループが必ず先頭。**
 *
 * 控えが無い・読めない間は主グループのみ ＝ 現行の単一グループ挙動。
 * 控えを増やすのは G-2b（グループ作成/参加 UI）と `refreshKnownSyncGroups()` だけで、
 * **同期の通常経路からサーバーへ問い合わせはしない**（古いサーバーへ余計な 404 を
 * 出さない・単一グループの通信を現行と同一に保つ）。
 */
export async function getKnownSyncGroupIds(primaryGroupId: string): Promise<string[]> {
  if (!isNativePlatform) return [primaryGroupId];
  try {
    const raw = await getAppMeta(KNOWN_GROUPS_KEY);
    if (!raw) return [primaryGroupId];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [primaryGroupId];
    const others = parsed.filter(
      (id): id is string => typeof id === 'string' && id !== '' && id !== primaryGroupId,
    );
    return [primaryGroupId, ...others];
  } catch {
    return [primaryGroupId];
  }
}

export async function setKnownSyncGroupIds(groupIds: readonly string[]): Promise<void> {
  await setAppMeta(KNOWN_GROUPS_KEY, JSON.stringify([...new Set(groupIds)])).catch(() => undefined);
}

/** グループから外された（401）とき、控えから 1 件だけ落とす */
export async function removeKnownSyncGroup(groupId: string): Promise<void> {
  if (!isNativePlatform) return;
  try {
    const credentials = await getStoredCredentials();
    if (!credentials) return;
    const known = await getKnownSyncGroupIds(credentials.groupId);
    await setKnownSyncGroupIds(known.filter((id) => id !== groupId));
  } catch {
    // 控えが古いだけ。次の pull の 401 でまた落とす機会がある
  }
}

/**
 * サーバーの membership 一覧で控えを更新する（G-2b の UI・共有の管理から呼ぶ）。
 * 古いサーバー（404）やオフラインでは何もしない — 同期を止める理由にしない。
 */
export async function refreshKnownSyncGroups(): Promise<void> {
  if (!isNativePlatform) return;
  try {
    const groups = await listSyncGroups();
    if (groups.length > 0) await setKnownSyncGroupIds(groups.map((group) => group.groupId));
  } catch {
    // 控えは前のまま。主グループだけでも同期は成立する
  }
}

/**
 * 「現在のグループ」（G2: 新規データの既定所属先）。未参加なら null、
 * 未設定・参加していないグループを指しているときは主グループ（＝現行挙動）。
 */
export async function getCurrentSyncGroupId(): Promise<string | null> {
  const credentials = await getStoredCredentials();
  if (!credentials) return null;
  const stored = await getAppMeta(CURRENT_GROUP_KEY).catch(() => null);
  const known = await getKnownSyncGroupIds(credentials.groupId);
  return resolveCurrentGroupId(stored || null, credentials.groupId, known);
}

/** グループ切替（G-2b の UI から）。null で未設定（＝主グループ）に戻す */
export async function setCurrentSyncGroupId(groupId: string | null): Promise<void> {
  await setAppMeta(CURRENT_GROUP_KEY, groupId ?? '').catch(() => undefined);
}

// ── 所属の読み書き ───────────────────────────────────────────────────────────

async function insertMemberships(keys: readonly EntityGroupKey[], groupId: string): Promise<void> {
  if (keys.length === 0) return;
  const db = getDb();
  for (let start = 0; start < keys.length; start += INSERT_CHUNK) {
    const chunk = keys.slice(start, start + INSERT_CHUNK);
    await db
      .insert(schema.entityGroups)
      .values(chunk.map((key) => ({ ...key, groupId })))
      .onConflictDoNothing();
  }
}

/**
 * 受信した実体を受信元グループへ所属させる（§12-3 pull）。
 * 既に他グループの所属があっても**追加**する（1 実体・複数グループ参照 — G3）。
 * 失敗しても投げない（受信適用そのものは成功している）。
 */
export async function registerEntityGroup(
  entityType: string,
  entityId: string,
  groupId: string,
): Promise<void> {
  if (!isNativePlatform) return;
  try {
    await insertMemberships([entityGroupKeyOf(entityType, entityId)], groupId);
  } catch {
    // 所属は push 時の既定所属（resolveMembershipsForPush）でも付き直る
  }
}

/**
 * 種別ごとの「行があるか・共有か」。既定所属を付けてよいかの材料
 * （判断そのものは `shouldAssignDefaultGroup` — 純関数）。
 */
async function describeEntityForGrouping(
  key: EntityGroupKey,
): Promise<{ rowExists: boolean; shared: number | null }> {
  const db = getDb();
  switch (key.entityType) {
    case SYNC_ENTITY_RECIPE: {
      const rows = await db
        .select({ id: schema.recipes.id })
        .from(schema.recipes)
        .where(eq(schema.recipes.id, key.entityId))
        .limit(1);
      return { rowExists: rows.length > 0, shared: null };
    }
    case SYNC_ENTITY_RECIPE_BOOK: {
      const rows = await db
        .select({ id: schema.recipeBooks.id })
        .from(schema.recipeBooks)
        .where(eq(schema.recipeBooks.id, key.entityId))
        .limit(1);
      return { rowExists: rows.length > 0, shared: null };
    }
    case SYNC_ENTITY_SHOPPING_ITEM: {
      const rows = await db
        .select({ shared: schema.shoppingItems.shared })
        .from(schema.shoppingItems)
        .where(eq(schema.shoppingItems.id, key.entityId))
        .limit(1);
      return rows[0]
        ? { rowExists: true, shared: rows[0].shared }
        : { rowExists: false, shared: null };
    }
    case SYNC_ENTITY_PANTRY_ITEM: {
      const rows = await db
        .select({ shared: schema.pantryItems.shared })
        .from(schema.pantryItems)
        .where(eq(schema.pantryItems.id, key.entityId))
        .limit(1);
      return rows[0]
        ? { rowExists: true, shared: rows[0].shared }
        : { rowExists: false, shared: null };
    }
    case SYNC_ENTITY_NAME_ALIAS: {
      const rows = await db
        .select({ id: schema.nameAliases.id })
        .from(schema.nameAliases)
        .where(eq(schema.nameAliases.id, key.entityId))
        .limit(1);
      return { rowExists: rows.length > 0, shared: null };
    }
    case SYNC_ENTITY_JAN_CATALOG: {
      const rows = await db
        .select({ id: schema.janCatalog.id })
        .from(schema.janCatalog)
        .where(eq(schema.janCatalog.id, key.entityId))
        .limit(1);
      return { rowExists: rows.length > 0, shared: null };
    }
    case SYNC_ENTITY_STORE_GROUP_ALIAS: {
      const rows = await db
        .select({ id: schema.storeGroupAliases.id })
        .from(schema.storeGroupAliases)
        .where(eq(schema.storeGroupAliases.id, key.entityId))
        .limit(1);
      return { rowExists: rows.length > 0, shared: null };
    }
    default:
      // 知らない種別（持ち分の id が壊れている等）。既定所属は付けない
      return { rowExists: false, shared: null };
  }
}

/**
 * push 1 バッチ分の所属を解決する（ファンアウトの材料 — 分配は `planPushFanout`）。
 *
 * - 返り値の鍵は `entityGroupMapKey(entityGroupKeyOf(...))`
 * - **参加中と分かっているグループ（knownGroupIds）との交わりだけ**を返す。
 *   他人のバックアップ復元などで残った未参加グループへ送ると 401 で同期が止まる
 * - 所属が 1 つも無い実体は、既定所属（G2: 現在のグループ）を付けてよいか判定し、
 *   付けたら entity_groups にも書く。付けられない実体は空配列 ＝ どこにも送らない（G9）
 */
export async function resolveMembershipsForPush(
  entities: readonly { entityType: string; entityId: string }[],
  currentGroupId: string,
  knownGroupIds: readonly string[],
): Promise<Map<string, readonly string[]>> {
  const keys = new Map<string, EntityGroupKey>();
  for (const entity of entities) {
    const key = entityGroupKeyOf(entity.entityType, entity.entityId);
    keys.set(entityGroupMapKey(key), key);
  }

  const memberships = new Map<string, string[]>();
  const entityIds = [...new Set([...keys.values()].map((key) => key.entityId))];
  if (entityIds.length > 0) {
    const rows = await getDb()
      .select()
      .from(schema.entityGroups)
      .where(inArray(schema.entityGroups.entityId, entityIds));
    for (const row of rows) {
      const mapKey = entityGroupMapKey({ entityType: row.entityType, entityId: row.entityId });
      if (!keys.has(mapKey)) continue; // entityId は同じでも種別が違う行
      if (!knownGroupIds.includes(row.groupId)) continue; // 未参加グループへは送らない
      const list = memberships.get(mapKey);
      if (list) list.push(row.groupId);
      else memberships.set(mapKey, [row.groupId]);
    }
  }

  for (const [mapKey, key] of keys) {
    if (memberships.has(mapKey)) continue;
    const info = await describeEntityForGrouping(key);
    if (
      shouldAssignDefaultGroup({
        hasMemberships: false,
        rowExists: info.rowExists,
        shared: info.shared,
      })
    ) {
      await insertMemberships([key], currentGroupId);
      memberships.set(mapKey, [currentGroupId]);
    } else {
      memberships.set(mapKey, []);
    }
  }
  return memberships;
}

// ── 移行（§12-4 G7: 挙動不変） ──────────────────────────────────────────────

/**
 * 一度きりの所属バックフィル。参加済みなら「現在同期対象の全実体」を主グループへ
 * 所属させる（`listAllSyncableEntities()` は `shared = 0` を最初から含まない — G9）。
 *
 * 加えて**送信待ちに残っている実体**も主グループへ所属させる。行が既に消えた実体の
 * tombstone は `listAllSyncableEntities()` に現れないが、所属が無いと G9 の規則で
 * 「送らない」に落ち、**アプリ更新をまたいだ削除が他端末に届かなくなる**ため。
 * （待ち行列はすべて単一グループ時代に積まれたもの ＝ 主グループ宛てで正しい。）
 *
 * 戻り値は「バックフィル済みか」。false の間、呼び出し側（sync-runner）は
 * ファンアウトせず従来どおり全部を主グループへ送る — 所属が無いだけの実体を
 * 「自分だけ」と誤読して送信待ちを捨てないための安全弁。
 */
export async function ensureEntityGroupsBackfilled(primaryGroupId: string): Promise<boolean> {
  if (!isNativePlatform) return false;
  try {
    if ((await getAppMeta(ENTITY_GROUPS_MIGRATED_KEY)) === '1') return true;

    const keys = new Map<string, EntityGroupKey>();
    for (const entity of await listAllSyncableEntities()) {
      const key = entityGroupKeyOf(entity.entityType, entity.entityId);
      keys.set(entityGroupMapKey(key), key);
    }
    for (const entry of await listSyncQueue(1_000_000)) {
      // 持ち分は親品目の所属に従う。親が shared = 0 のときに親へ所属を付けてしまわない
      if (entry.entityType === SYNC_ENTITY_PANTRY_QUANTITY) continue;
      const key = entityGroupKeyOf(entry.entityType, entry.entityId);
      keys.set(entityGroupMapKey(key), key);
    }
    await insertMemberships([...keys.values()], primaryGroupId);
    await setAppMeta(ENTITY_GROUPS_MIGRATED_KEY, '1');
    return true;
  } catch {
    // 次の同期でやり直す。完了までファンアウトは使われない（上記の安全弁）
    return false;
  }
}

/**
 * 離脱・グループ削除時の後始末。所属と多グループの文脈をすべて白紙に戻す
 * （G-2a では離脱＝唯一のグループから抜けること。次の参加時にバックフィルが
 * 走り直し、新しいグループへ全実体が所属し直す — 現行の「参加時 全量同期」と同義）。
 */
export async function resetEntityGroupsForLeave(): Promise<void> {
  if (!isNativePlatform) return;
  try {
    await getDb().delete(schema.entityGroups);
  } catch {
    // 残っても未参加の間は使われない。次のバックフィルで上書きされる
  }
  await setAppMeta(ENTITY_GROUPS_MIGRATED_KEY, '').catch(() => undefined);
  await setAppMeta(CURRENT_GROUP_KEY, '').catch(() => undefined);
  await setAppMeta(KNOWN_GROUPS_KEY, '').catch(() => undefined);
}
