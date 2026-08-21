/**
 * ローカル DB ⇄ 同期ペイロードの変換（S1 — `docs/クラウド同期設計.md` §5-1b）。
 *
 * - **送信**: `sync_queue` に積まれた印を見て、その時点の DB から payload を作る
 * - **受信**: 他端末の payload をローカルへ適用する（LWW はここで判定する）
 *
 * 設計どおりに実装するうえで、設計書の文面から動かした点が 3 つある。理由込みで残す:
 *
 * 1. **レシピの削除は行を消さない。** アプリの「削除」は `status='archived'`（論理削除）で、
 *    リビジョン・材料・手順・調理記録が `recipes.id` を外部キーで参照している
 *    （`PRAGMA foreign_keys = ON`）。受信側で行を DELETE すると外部キーで落ちるので、
 *    受信 tombstone も **archived に倒す**。帖は元々物理削除なので設計どおり DELETE する。
 * 2. **出所（sources）を payload に含める。** Web 共有の出所ゲート
 *    （`getUrlImportedRecipeIds` は `sources.type='url'` で判定）が、出所の無い受信側で
 *    素通しになってしまうため。生 OCR テキストは運ばない。
 * 3. **`familyId` / `createdBy` は運ばず、受信側のローカル値を入れる。** 全端末で
 *    `family-001` / `user-kei` 固定なので運ぶ意味が無く、運べば外部キー違反になりうる。
 *
 * S1 の割り切り: **写真は同期しない**（設計 §5-1b）。受信適用でローカルの写真列を
 * 消さないよう、表紙は行を上書きするときに列を触らず、手順写真は**手順 ID が一致する分だけ**
 * 引き継ぐ。他端末が編集して新しいリビジョンになると手順写真の参照は外れる（S3 で解消）。
 */
import { and, eq } from 'drizzle-orm';

import { getDb, getExpoDb, isNativePlatform } from '../db/client';
import { shouldHideSeedRecipe } from '../db/sampleData';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import {
  SYNC_ENTITY_RECIPE,
  SYNC_ENTITY_RECIPE_BOOK,
  SYNC_PAYLOAD_SCHEMA_VERSION,
  incomingChangeWins,
  parseSyncPayload,
  serializeSyncPayload,
  type RecipeBookSyncPayload,
  type RecipeSyncPayload,
  type SyncEntityType,
} from './sync-payload';
import { withRemoteApply } from './sync-queue.service';

/** レシピ・タグの所属。全端末で同じ固定値（`recipe.service.ts` と揃える） */
const FAMILY_ID = 'family-001';
const USER_ID = 'user-kei';

function nowIso(): string {
  return new Date().toISOString();
}

export interface OutgoingChange {
  entityType: string;
  entityId: string;
  /** null = tombstone（削除） */
  payload: string | null;
  clientUpdatedAt: string;
  deleted: boolean;
}

export interface IncomingChange {
  entityType: string;
  entityId: string;
  payload: string | null;
  clientUpdatedAt: string;
  deleted: boolean;
  seq: number;
  updatedByDevice: string;
}

// ── 送信: DB → payload ───────────────────────────────────────────────────────

async function buildRecipeChange(recipeId: string): Promise<OutgoingChange | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.recipes)
    .where(eq(schema.recipes.id, recipeId))
    .limit(1);
  const recipe = rows[0];
  if (!recipe) {
    // 行ごと消えている（バックアップ復元など）。他端末からも消す
    return {
      entityType: SYNC_ENTITY_RECIPE,
      entityId: recipeId,
      payload: null,
      clientUpdatedAt: nowIso(),
      deleted: true,
    };
  }

  const revisionRows = recipe.currentRevId
    ? await db
        .select()
        .from(schema.recipeRevisions)
        .where(eq(schema.recipeRevisions.id, recipe.currentRevId))
        .limit(1)
    : [];
  const revision = revisionRows[0] ?? null;

  const sourceRows = revision?.sourceId
    ? await db
        .select()
        .from(schema.sources)
        .where(eq(schema.sources.id, revision.sourceId))
        .limit(1)
    : [];
  const source = sourceRows[0] ?? null;

  const ingredientRows = revision
    ? await db
        .select()
        .from(schema.ingredients)
        .where(eq(schema.ingredients.revisionId, revision.id))
        .orderBy(schema.ingredients.sortOrder)
    : [];

  const stepRows = revision
    ? await db
        .select()
        .from(schema.steps)
        .where(eq(schema.steps.revisionId, revision.id))
        .orderBy(schema.steps.sortOrder)
    : [];

  const tagRows = await db
    .select({ name: schema.tags.name })
    .from(schema.recipeTags)
    .innerJoin(schema.tags, eq(schema.recipeTags.tagId, schema.tags.id))
    .where(eq(schema.recipeTags.recipeId, recipeId));

  const payload: RecipeSyncPayload = {
    schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
    entity: SYNC_ENTITY_RECIPE,
    recipe: {
      id: recipe.id,
      title: recipe.title,
      titleReading: recipe.titleReading,
      status: recipe.status,
      placeName: recipe.placeName,
      pinnedAt: recipe.pinnedAt,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    },
    revision: revision
      ? {
          id: revision.id,
          revisionNumber: revision.revisionNumber,
          isMajor: revision.isMajor,
          servings: revision.servings,
          cookTimeMin: revision.cookTimeMin,
          prepTimeMin: revision.prepTimeMin,
          description: revision.description,
          authorNote: revision.authorNote,
          createdAt: revision.createdAt,
        }
      : null,
    source: source
      ? {
          id: source.id,
          type: source.type,
          url: source.url,
          siteName: source.siteName,
          pageTitle: source.pageTitle,
          capturedAt: source.capturedAt,
          createdAt: source.createdAt,
        }
      : null,
    ingredients: ingredientRows.map((row) => ({
      id: row.id,
      sortOrder: row.sortOrder,
      groupLabel: row.groupLabel,
      name: row.name,
      amount: row.amount,
      note: row.note,
    })),
    steps: stepRows.map((row) => ({
      id: row.id,
      sortOrder: row.sortOrder,
      body: row.body,
      timerSec: row.timerSec,
    })),
    tags: tagRows.map((row) => row.name),
  };

  return {
    entityType: SYNC_ENTITY_RECIPE,
    entityId: recipeId,
    payload: serializeSyncPayload(payload),
    clientUpdatedAt: recipe.updatedAt,
    deleted: false,
  };
}

async function buildRecipeBookChange(bookId: string): Promise<OutgoingChange | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.recipeBooks)
    .where(eq(schema.recipeBooks.id, bookId))
    .limit(1);
  const book = rows[0];
  if (!book) {
    return {
      entityType: SYNC_ENTITY_RECIPE_BOOK,
      entityId: bookId,
      payload: null,
      clientUpdatedAt: nowIso(),
      deleted: true,
    };
  }

  const itemRows = await db
    .select({ recipeId: schema.recipeBookItems.recipeId })
    .from(schema.recipeBookItems)
    .where(eq(schema.recipeBookItems.bookId, bookId))
    .orderBy(schema.recipeBookItems.position);

  const payload: RecipeBookSyncPayload = {
    schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
    entity: SYNC_ENTITY_RECIPE_BOOK,
    book: {
      id: book.id,
      title: book.title,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
    },
    recipeIds: itemRows.map((row) => row.recipeId),
  };

  return {
    entityType: SYNC_ENTITY_RECIPE_BOOK,
    entityId: bookId,
    payload: serializeSyncPayload(payload),
    clientUpdatedAt: book.updatedAt,
    deleted: false,
  };
}

/** 送信 1 件分を組み立てる。組み立てられなければ null（その 1 件は送らない） */
export async function buildOutgoingChange(
  entityType: string,
  entityId: string,
): Promise<OutgoingChange | null> {
  if (!isNativePlatform) return null;
  try {
    if (entityType === SYNC_ENTITY_RECIPE) return await buildRecipeChange(entityId);
    if (entityType === SYNC_ENTITY_RECIPE_BOOK) return await buildRecipeBookChange(entityId);
    return null;
  } catch {
    return null;
  }
}

/**
 * いま端末にあるものを全部（グループ参加直後の積み直し用）。
 *
 * v1 では**レシピと帖は全量同期**する（設計 §5-2。参加の同意ダイアログに明記済み）。
 * サンプルデータのレシピは、表示していない端末では送らない。
 */
export async function listAllSyncableEntities(): Promise<
  { entityType: SyncEntityType; entityId: string }[]
> {
  if (!isNativePlatform) return [];
  try {
    const db = getDb();
    const recipeRows = await db.select({ id: schema.recipes.id }).from(schema.recipes);
    const bookRows = await db.select({ id: schema.recipeBooks.id }).from(schema.recipeBooks);
    return [
      ...recipeRows
        .filter((row) => !shouldHideSeedRecipe(row.id))
        .map((row) => ({ entityType: SYNC_ENTITY_RECIPE, entityId: row.id }) as const),
      ...bookRows.map(
        (row) => ({ entityType: SYNC_ENTITY_RECIPE_BOOK, entityId: row.id }) as const,
      ),
    ];
  } catch {
    return [];
  }
}

// ── 受信: payload → DB ──────────────────────────────────────────────────────

async function ensureTagId(name: string): Promise<string | null> {
  const db = getDb();
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.familyId, FAMILY_ID), eq(schema.tags.name, trimmed)))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const id = generateId();
  await db.insert(schema.tags).values({ id, familyId: FAMILY_ID, name: trimmed, color: null });
  return id;
}

/** FTS は派生データなので、適用のたびに作り直す（失敗しても本体は正しい） */
function updateFtsForRecipe(payload: RecipeSyncPayload): void {
  try {
    const expoDb = getExpoDb();
    expoDb.runSync('DELETE FROM recipe_fts WHERE recipe_id = ?', [payload.recipe.id]);
    if (payload.recipe.status !== 'active') return;
    expoDb.runSync(
      'INSERT INTO recipe_fts (recipe_id, title, title_reading, ingredient_names) VALUES (?, ?, ?, ?)',
      [
        payload.recipe.id,
        payload.recipe.title,
        payload.recipe.titleReading ?? '',
        payload.ingredients.map((item) => item.name).join(' '),
      ],
    );
  } catch {
    // FTS 表がまだ無い（初回起動直後）等。検索に出ないだけで本体は入っている
  }
}

async function applyRecipePayload(payload: RecipeSyncPayload): Promise<boolean> {
  const db = getDb();

  const localRows = await db
    .select({ updatedAt: schema.recipes.updatedAt })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, payload.recipe.id))
    .limit(1);
  const local = localRows[0] ?? null;
  if (!incomingChangeWins(payload.recipe.updatedAt, local?.updatedAt ?? null)) return false;

  // 1. 出所（外部キーの親なので先に）
  if (payload.source) {
    await db
      .insert(schema.sources)
      .values({
        id: payload.source.id,
        type: payload.source.type,
        url: payload.source.url,
        ocrRawText: null,
        siteName: payload.source.siteName,
        pageTitle: payload.source.pageTitle,
        thumbnailUrl: null,
        capturedAt: payload.source.capturedAt,
        createdAt: payload.source.createdAt,
      })
      .onConflictDoNothing();
  }

  // 2. レシピ本体。**表紙写真の列は触らない**（受信側の写真を消さないため）
  await db
    .insert(schema.recipes)
    .values({
      id: payload.recipe.id,
      familyId: FAMILY_ID,
      title: payload.recipe.title,
      titleReading: payload.recipe.titleReading,
      currentRevId: payload.revision?.id ?? null,
      status: payload.recipe.status,
      coverPhotoPath: null,
      pinnedAt: payload.recipe.pinnedAt,
      placeName: payload.recipe.placeName,
      createdBy: USER_ID,
      createdAt: payload.recipe.createdAt,
      updatedAt: payload.recipe.updatedAt,
    })
    .onConflictDoUpdate({
      target: schema.recipes.id,
      set: {
        title: payload.recipe.title,
        titleReading: payload.recipe.titleReading,
        currentRevId: payload.revision?.id ?? null,
        status: payload.recipe.status,
        pinnedAt: payload.recipe.pinnedAt,
        placeName: payload.recipe.placeName,
        updatedAt: payload.recipe.updatedAt,
      },
    });

  const revision = payload.revision;
  if (revision) {
    // 3. リビジョン
    await db
      .insert(schema.recipeRevisions)
      .values({
        id: revision.id,
        recipeId: payload.recipe.id,
        revisionNumber: revision.revisionNumber,
        isMajor: revision.isMajor,
        servings: revision.servings,
        cookTimeMin: revision.cookTimeMin,
        prepTimeMin: revision.prepTimeMin,
        description: revision.description,
        authorNote: revision.authorNote,
        sourceId: payload.source?.id ?? null,
        createdBy: USER_ID,
        createdAt: revision.createdAt,
      })
      .onConflictDoUpdate({
        target: schema.recipeRevisions.id,
        set: {
          revisionNumber: revision.revisionNumber,
          isMajor: revision.isMajor,
          servings: revision.servings,
          cookTimeMin: revision.cookTimeMin,
          prepTimeMin: revision.prepTimeMin,
          description: revision.description,
          authorNote: revision.authorNote,
          sourceId: payload.source?.id ?? null,
        },
      });

    // 4. 材料（丸ごと置換）
    await db.delete(schema.ingredients).where(eq(schema.ingredients.revisionId, revision.id));
    for (const item of payload.ingredients) {
      await db.insert(schema.ingredients).values({
        id: item.id,
        revisionId: revision.id,
        sortOrder: item.sortOrder,
        groupLabel: item.groupLabel,
        name: item.name,
        amount: item.amount,
        note: item.note,
      });
    }

    // 5. 手順（丸ごと置換）。**手順 ID が一致する分だけローカルの写真を引き継ぐ**
    const existingSteps = await db
      .select({ id: schema.steps.id, photoPath: schema.steps.photoPath })
      .from(schema.steps)
      .where(eq(schema.steps.revisionId, revision.id));
    const photoByStepId = new Map(
      existingSteps.filter((step) => step.photoPath).map((step) => [step.id, step.photoPath]),
    );
    await db.delete(schema.steps).where(eq(schema.steps.revisionId, revision.id));
    for (const step of payload.steps) {
      await db.insert(schema.steps).values({
        id: step.id,
        revisionId: revision.id,
        sortOrder: step.sortOrder,
        body: step.body,
        timerSec: step.timerSec,
        photoId: null,
        photoPath: photoByStepId.get(step.id) ?? null,
      });
    }
  }

  // 6. タグ（名前で引き当て → 張り替え）
  await db.delete(schema.recipeTags).where(eq(schema.recipeTags.recipeId, payload.recipe.id));
  const seenTagIds = new Set<string>();
  for (const name of payload.tags) {
    const tagId = await ensureTagId(name);
    if (!tagId || seenTagIds.has(tagId)) continue;
    seenTagIds.add(tagId);
    await db.insert(schema.recipeTags).values({ recipeId: payload.recipe.id, tagId });
  }

  updateFtsForRecipe(payload);
  return true;
}

/**
 * レシピの受信 tombstone。**行は消さず archived に倒す**
 * （子テーブルが `recipes.id` を参照しているので DELETE は外部キーで落ちる）。
 */
async function applyRecipeTombstone(entityId: string, clientUpdatedAt: string): Promise<boolean> {
  const db = getDb();
  const localRows = await db
    .select({ updatedAt: schema.recipes.updatedAt })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, entityId))
    .limit(1);
  const local = localRows[0];
  if (!local) return false; // そもそも持っていない
  if (!incomingChangeWins(clientUpdatedAt, local.updatedAt)) return false;

  await db
    .update(schema.recipes)
    .set({ status: 'archived', updatedAt: clientUpdatedAt })
    .where(eq(schema.recipes.id, entityId));
  try {
    getExpoDb().runSync('DELETE FROM recipe_fts WHERE recipe_id = ?', [entityId]);
  } catch {
    // 検索索引だけの話
  }
  return true;
}

async function applyRecipeBookPayload(payload: RecipeBookSyncPayload): Promise<boolean> {
  const db = getDb();
  const localRows = await db
    .select({ updatedAt: schema.recipeBooks.updatedAt })
    .from(schema.recipeBooks)
    .where(eq(schema.recipeBooks.id, payload.book.id))
    .limit(1);
  const local = localRows[0] ?? null;
  if (!incomingChangeWins(payload.book.updatedAt, local?.updatedAt ?? null)) return false;

  // 共有（slug・トークン・パスコード・期限）はローカルのまま。列を set に入れない
  await db
    .insert(schema.recipeBooks)
    .values({
      id: payload.book.id,
      title: payload.book.title,
      createdAt: payload.book.createdAt,
      updatedAt: payload.book.updatedAt,
    })
    .onConflictDoUpdate({
      target: schema.recipeBooks.id,
      set: { title: payload.book.title, updatedAt: payload.book.updatedAt },
    });

  await db.delete(schema.recipeBookItems).where(eq(schema.recipeBookItems.bookId, payload.book.id));
  const seen = new Set<string>();
  let position = 0;
  for (const recipeId of payload.recipeIds) {
    if (seen.has(recipeId)) continue; // (book_id, recipe_id) は一意
    seen.add(recipeId);
    await db.insert(schema.recipeBookItems).values({ bookId: payload.book.id, recipeId, position });
    position += 1;
  }
  return true;
}

/** 帖は元々物理削除なので、受信 tombstone も DELETE（子 → 親の順） */
async function applyRecipeBookTombstone(
  entityId: string,
  clientUpdatedAt: string,
): Promise<boolean> {
  const db = getDb();
  const localRows = await db
    .select({ updatedAt: schema.recipeBooks.updatedAt })
    .from(schema.recipeBooks)
    .where(eq(schema.recipeBooks.id, entityId))
    .limit(1);
  const local = localRows[0];
  if (!local) return false;
  if (!incomingChangeWins(clientUpdatedAt, local.updatedAt)) return false;

  await db.delete(schema.recipeBookItems).where(eq(schema.recipeBookItems.bookId, entityId));
  await db.delete(schema.recipeBooks).where(eq(schema.recipeBooks.id, entityId));
  return true;
}

/**
 * 受信 1 件をローカルへ適用する。適用したら true。
 *
 * **1 件の失敗で同期全体を止めない** — 壊れた payload・想定外のエンティティは
 * false を返して読み飛ばす（`last_pull_seq` は進むので同期は先へ進む）。
 * 適用中は `sync_queue` に積まない（受け取った変更を押し返さないため）。
 */
export async function applyIncomingChange(change: IncomingChange): Promise<boolean> {
  if (!isNativePlatform) return false;
  try {
    return await withRemoteApply(async () => {
      if (change.deleted) {
        if (change.entityType === SYNC_ENTITY_RECIPE) {
          return applyRecipeTombstone(change.entityId, change.clientUpdatedAt);
        }
        if (change.entityType === SYNC_ENTITY_RECIPE_BOOK) {
          return applyRecipeBookTombstone(change.entityId, change.clientUpdatedAt);
        }
        return false;
      }

      const payload = parseSyncPayload(change.entityType, change.payload);
      if (!payload) return false;
      if (payload.entity === SYNC_ENTITY_RECIPE) {
        if (payload.recipe.id !== change.entityId) return false; // 封筒と中身の食い違い
        return applyRecipePayload(payload);
      }
      if (payload.entity === SYNC_ENTITY_RECIPE_BOOK) {
        if (payload.book.id !== change.entityId) return false;
        return applyRecipeBookPayload(payload);
      }
      return false;
    });
  } catch {
    return false;
  }
}
