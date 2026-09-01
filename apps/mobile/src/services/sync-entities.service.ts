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
import { setAppMeta } from './app-meta.service';
import { revokeSharedBook } from './recipe-book.service';
import { URL_IMPORTED_META_PREFIX } from './web-share.service';
import {
  SYNC_ENTITY_RECIPE,
  SYNC_ENTITY_RECIPE_BOOK,
  SYNC_PAYLOAD_SCHEMA_VERSION,
  incomingChangeWins,
  isRowSyncPayload,
  parseSyncPayload,
  serializeSyncPayload,
  type RecipeBookSyncPayload,
  type RecipeSyncPayload,
  type SyncEntityType,
} from './sync-payload';
import { withRemoteApply } from './sync-queue.service';
import {
  applyRowPayload,
  applyRowTombstone,
  buildRowOutgoingChange,
  isRowEntityType,
  listRowSyncableEntities,
} from './sync-row-entities.service';

/** レシピ・タグの所属。全端末で同じ固定値（`recipe.service.ts` と揃える） */
const FAMILY_ID = 'family-001';
const USER_ID = 'user-kei';

export interface OutgoingChange {
  entityType: string;
  entityId: string;
  /** null = tombstone（削除） */
  payload: string | null;
  clientUpdatedAt: string;
  deleted: boolean;
}

/**
 * 送信 1 件の組み立て結果。
 *
 * `unsupported`（＝知らない種別）と `error`（＝一時的な失敗）を分けるのが要点。
 * 両方を null に潰すと、DB が一瞬掴めなかっただけで**利用者の編集が待ち行列から
 * 消えて永久に送られない**。捨てていいのは「送りようが無い」ときだけ。
 */
export type OutgoingChangeResult =
  | { kind: 'change'; change: OutgoingChange }
  | { kind: 'unsupported' }
  | { kind: 'error' };

/**
 * 受信 1 件の適用結果。
 *
 * `skipped`（LWW で負けた・持っていない・読めない payload）はカーソルを進めてよい。
 * `failed`（書き込み中の例外）は**カーソルを進めてはいけない** — 進めると、
 * 材料が欠けたまま二度と直らないレシピが残る。
 */
export type ApplyOutcome = 'applied' | 'skipped' | 'failed';

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

async function buildRecipeChange(recipeId: string, deletedAt: string): Promise<OutgoingChange> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.recipes)
    .where(eq(schema.recipes.id, recipeId))
    .limit(1);
  const recipe = rows[0];
  if (!recipe) {
    // 行ごと消えている（バックアップ復元など）。他端末からも消す。
    // 時刻は**待ち行列に積んだ時刻**（＝消した時刻）を使う。送信時刻にすると、
    // オフライン中の削除が、その後に他端末がした更新に勝ってしまう
    return {
      entityType: SYNC_ENTITY_RECIPE,
      entityId: recipeId,
      payload: null,
      clientUpdatedAt: deletedAt,
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

  // 出所ゲート用。現在のリビジョンだけでなく**どれかのリビジョン**が URL 由来なら真
  const urlSourceRows = await db
    .select({ id: schema.recipeRevisions.id })
    .from(schema.recipeRevisions)
    .innerJoin(schema.sources, eq(schema.recipeRevisions.sourceId, schema.sources.id))
    .where(and(eq(schema.recipeRevisions.recipeId, recipeId), eq(schema.sources.type, 'url')))
    .limit(1);
  const urlImported = urlSourceRows.length > 0 || source?.type === 'url';

  const payload: RecipeSyncPayload = {
    schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
    entity: SYNC_ENTITY_RECIPE,
    recipe: {
      id: recipe.id,
      title: recipe.title,
      titleReading: recipe.titleReading,
      status: recipe.status,
      placeName: recipe.placeName,
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
    urlImported,
    // AI 由来の印（#266）。**真のときだけ送る** — false を送っても意味が無いうえ、
    // 受信側が「AI ではないと確かめた」と誤解する余地を作らない
    ...(recipe.aiGenerated === 1 ? { aiGenerated: true } : {}),
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

async function buildRecipeBookChange(bookId: string, deletedAt: string): Promise<OutgoingChange> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.recipeBooks)
    .where(eq(schema.recipeBooks.id, bookId))
    .limit(1);
  const book = rows[0];
  if (!book) {
    // 帖は物理削除。時刻は積んだ時刻（＝消した時刻）— レシピ側と同じ理由
    return {
      entityType: SYNC_ENTITY_RECIPE_BOOK,
      entityId: bookId,
      payload: null,
      clientUpdatedAt: deletedAt,
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

/**
 * 送信 1 件分を組み立てる。
 *
 * `deletedAt` は待ち行列に積んだ時刻。ローカルに行が無い（＝消された）ときの
 * tombstone の時刻に使う（送信時刻ではなく、消した時刻で勝敗を決めるため）。
 */
export async function buildOutgoingChange(
  entityType: string,
  entityId: string,
  deletedAt: string,
): Promise<OutgoingChangeResult> {
  if (!isNativePlatform) return { kind: 'unsupported' };
  try {
    if (entityType === SYNC_ENTITY_RECIPE) {
      return { kind: 'change', change: await buildRecipeChange(entityId, deletedAt) };
    }
    if (entityType === SYNC_ENTITY_RECIPE_BOOK) {
      return { kind: 'change', change: await buildRecipeBookChange(entityId, deletedAt) };
    }
    // 買い物・在庫・辞書（S2）。1 行で完結する種別は別モジュールが持つ
    if (isRowEntityType(entityType)) {
      return buildRowOutgoingChange(entityType, entityId, deletedAt);
    }
    return { kind: 'unsupported' };
  } catch {
    // DB が一瞬掴めなかった等。**捨てずに待ち行列へ残す**
    return { kind: 'error' };
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
      // 買い物・在庫・辞書（S2）。**共有していない行は含まれない**
      ...(await listRowSyncableEntities()),
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

/**
 * 受信でレシピ行に書く「AI 由来の印」の差分（#266）。**立つときだけ返す。**
 *
 * `{ aiGenerated: payload.aiGenerated ? 1 : null }` と書いてはいけない。
 * 印を知らない古い端末は payload にこの欄を持たないので、その 1 通が後勝ちした瞬間に
 * **手元で立っている印が潰れる**。`pinnedAt` を `set` から外しているのと同じ考え方。
 *
 * 純関数にしてあるのは、`applyRecipePayload` が DB を掴んでいてテストから叩けないため
 * （`docs/品質基準.md` §2.3「規則は分岐の手前の純関数へ切り出す」）。
 */
export function incomingAiGeneratedPatch(payload: { aiGenerated?: boolean }): { aiGenerated?: 1 } {
  return payload.aiGenerated ? { aiGenerated: 1 } : {};
}

async function applyRecipePayload(payload: RecipeSyncPayload): Promise<ApplyOutcome> {
  const db = getDb();

  const localRows = await db
    .select({ updatedAt: schema.recipes.updatedAt })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, payload.recipe.id))
    .limit(1);
  const local = localRows[0] ?? null;
  if (!incomingChangeWins(payload.recipe.updatedAt, local?.updatedAt ?? null)) return 'skipped';

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

  // 1b. URL 取り込み由来の印。出所行が届かないリビジョンでもゲートが効くように、
  //     レシピ単位の印を app_meta に残す（`getShareBlockReason` がこれも見る）
  if (payload.urlImported) {
    await setAppMeta(URL_IMPORTED_META_PREFIX + payload.recipe.id, '1').catch(() => undefined);
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
      // 作りたいリストは人ごとの都合なので運ばない（新規受信は未ピンで入る）
      pinnedAt: null,
      placeName: payload.recipe.placeName,
      aiGenerated: payload.aiGenerated ? 1 : null,
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
        // pinnedAt は set に入れない ＝ ローカルのピンを消さない
        placeName: payload.recipe.placeName,
        // **立つときだけ含める。** 規則の実体は incomingAiGeneratedPatch（純関数・テスト対象）
        ...incomingAiGeneratedPatch(payload),
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
  return 'applied';
}

/**
 * レシピの受信 tombstone。**行は消さず archived に倒す**
 * （子テーブルが `recipes.id` を参照しているので DELETE は外部キーで落ちる）。
 */
async function applyRecipeTombstone(
  entityId: string,
  clientUpdatedAt: string,
): Promise<ApplyOutcome> {
  const db = getDb();
  const localRows = await db
    .select({ updatedAt: schema.recipes.updatedAt })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, entityId))
    .limit(1);
  const local = localRows[0];
  if (!local) return 'skipped'; // そもそも持っていない
  if (!incomingChangeWins(clientUpdatedAt, local.updatedAt)) return 'skipped';

  await db
    .update(schema.recipes)
    .set({ status: 'archived', updatedAt: clientUpdatedAt })
    .where(eq(schema.recipes.id, entityId));
  try {
    getExpoDb().runSync('DELETE FROM recipe_fts WHERE recipe_id = ?', [entityId]);
  } catch {
    // 検索索引だけの話
  }
  return 'applied';
}

async function applyRecipeBookPayload(payload: RecipeBookSyncPayload): Promise<ApplyOutcome> {
  const db = getDb();
  const localRows = await db
    .select({ updatedAt: schema.recipeBooks.updatedAt })
    .from(schema.recipeBooks)
    .where(eq(schema.recipeBooks.id, payload.book.id))
    .limit(1);
  const local = localRows[0] ?? null;
  if (!incomingChangeWins(payload.book.updatedAt, local?.updatedAt ?? null)) return 'skipped';

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
  return 'applied';
}

/**
 * 帖は元々物理削除なので、受信 tombstone も DELETE（子 → 親の順）。
 *
 * ただし**この端末が Web 共有している帖は、先に公開を止めてからでないと消さない**。
 * 共有の鍵（`share_delete_token`）はこの端末のローカル行にしかなく（同期しない）、
 * 行ごと消すと**公開中のページを二度と止められなくなる**。他端末には共有中かどうかが
 * 見えない（受信側の行は share 列が空）ので、消した人はこの危険に気づけない。
 * 止められなかった（オフライン等）ときは**行を残す**— 消えるより、止める手段が残る方がよい。
 */
async function applyRecipeBookTombstone(
  entityId: string,
  clientUpdatedAt: string,
): Promise<ApplyOutcome> {
  const db = getDb();
  const localRows = await db
    .select({
      updatedAt: schema.recipeBooks.updatedAt,
      shareSlug: schema.recipeBooks.shareSlug,
      shareDeleteToken: schema.recipeBooks.shareDeleteToken,
    })
    .from(schema.recipeBooks)
    .where(eq(schema.recipeBooks.id, entityId))
    .limit(1);
  const local = localRows[0];
  if (!local) return 'skipped';
  if (!incomingChangeWins(clientUpdatedAt, local.updatedAt)) return 'skipped';

  if (local.shareSlug && local.shareDeleteToken) {
    const revoked = await revokeSharedBook(entityId).then(
      () => true,
      () => false,
    );
    if (!revoked) return 'skipped'; // 停止できないうちは消さない
  }

  await db.delete(schema.recipeBookItems).where(eq(schema.recipeBookItems.bookId, entityId));
  await db.delete(schema.recipeBooks).where(eq(schema.recipeBooks.id, entityId));
  return 'applied';
}

/**
 * 受信 1 件をローカルへ適用する。
 *
 * - `applied` … 書き込んだ
 * - `skipped` … 書く必要が無い/書けない（LWW で負けた・持っていない・読めない payload）。
 *   呼び出し側はカーソルを進めてよい
 * - `failed`  … 書き込みの途中で落ちた。**カーソルを進めてはいけない**
 *   （材料が欠けたレシピが残ったまま、次の pull で直る機会を失う）
 *
 * 適用中はその行だけ `sync_queue` に積まない（受け取った変更を押し返さないため）。
 */
export async function applyIncomingChange(change: IncomingChange): Promise<ApplyOutcome> {
  if (!isNativePlatform) return 'skipped';
  try {
    return await withRemoteApply(change.entityType, change.entityId, async () => {
      if (change.deleted) {
        if (change.entityType === SYNC_ENTITY_RECIPE) {
          return applyRecipeTombstone(change.entityId, change.clientUpdatedAt);
        }
        if (change.entityType === SYNC_ENTITY_RECIPE_BOOK) {
          return applyRecipeBookTombstone(change.entityId, change.clientUpdatedAt);
        }
        if (isRowEntityType(change.entityType)) {
          return applyRowTombstone(change.entityType, change.entityId, change.clientUpdatedAt);
        }
        return 'skipped';
      }

      const payload = parseSyncPayload(change.entityType, change.payload);
      if (!payload) return 'skipped';
      if (payload.entity === SYNC_ENTITY_RECIPE) {
        if (payload.recipe.id !== change.entityId) return 'skipped'; // 封筒と中身の食い違い
        return applyRecipePayload(payload);
      }
      if (payload.entity === SYNC_ENTITY_RECIPE_BOOK) {
        if (payload.book.id !== change.entityId) return 'skipped';
        return applyRecipeBookPayload(payload);
      }
      if (isRowSyncPayload(payload)) {
        if (payload.item.id !== change.entityId) return 'skipped'; // 封筒と中身の食い違い
        return applyRowPayload(payload);
      }
      return 'skipped';
    });
  } catch {
    // 書き込みの途中で落ちた可能性がある。カーソルを進めさせない
    return 'failed';
  }
}
