/**
 * Recipe service — centralized data access for recipe CRUD operations
 * Handles both native (SQLite) and web (mock) data paths
 */
import { isNativePlatform } from '../db/client';
import type { getDb } from '../db/client';
import type * as DbSchema from '../db/schema';
import { shouldHideSeedRecipe } from '../db/sampleData';
import {
  getMockRecipeDetail,
  getMockRecipeList,
  getMockRecipeRevisions,
  createMockRecipe,
  updateMockRecipe,
  deleteMockRecipe,
  setMockRecipePinned,
} from '../db/mock';
import { isAiGeneratedPhoto } from '../utils/aiGeneratedPhoto';
import { generateId } from '../utils/id';
import { recipeMatchesQuery } from '../utils/recipeSearch';
import { getAliasMap } from './name-alias.service';
import { resolvePhotoUri, toStoredPhotoPath } from './photo-path';
import { blankToNull, resolveRecipeUpdate } from './recipe-update';
import { SYNC_ENTITY_RECIPE } from './sync-payload';
import { enqueueSyncEntity } from './sync-queue.service';
import type {
  MemoItem,
  RecipeDetail,
  RecipeListItem,
  RecipeRevisionSummary,
  SaveRecipeInput,
  UpdateRecipeInput,
} from './types';

const FAMILY_ID = 'family-001';
const USER_ID = 'user-kei';

function nowIso(): string {
  return new Date().toISOString();
}

export async function getRecipeList(): Promise<RecipeListItem[]> {
  if (!isNativePlatform) {
    return getMockRecipeList();
  }

  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const allRecipes = await db
    .select({
      id: schema.recipes.id,
      title: schema.recipes.title,
      titleReading: schema.recipes.titleReading,
      currentRevId: schema.recipes.currentRevId,
      createdAt: schema.recipes.createdAt,
      coverPhotoPath: schema.recipes.coverPhotoPath,
      pinnedAt: schema.recipes.pinnedAt,
    })
    .from(schema.recipes)
    .where(eq(schema.recipes.status, 'active'));

  const visibleRecipes = allRecipes.filter((recipe) => !shouldHideSeedRecipe(recipe.id));

  const result: RecipeListItem[] = [];

  for (const recipe of visibleRecipes) {
    let cookTimeMin: number | null = null;
    if (recipe.currentRevId) {
      const revs = await db
        .select({ cookTimeMin: schema.recipeRevisions.cookTimeMin })
        .from(schema.recipeRevisions)
        .where(eq(schema.recipeRevisions.id, recipe.currentRevId))
        .limit(1);
      if (revs.length > 0) cookTimeMin = revs[0].cookTimeMin;
    }

    const tagRows = await db
      .select({ name: schema.tags.name })
      .from(schema.recipeTags)
      .leftJoin(schema.tags, eq(schema.recipeTags.tagId, schema.tags.id))
      .where(eq(schema.recipeTags.recipeId, recipe.id));

    const ratingRows = await db
      .select({ rating: schema.cookingLogs.rating })
      .from(schema.cookingLogs)
      .where(eq(schema.cookingLogs.recipeId, recipe.id));
    const ratings = ratingRows.filter((r) => r.rating != null);
    const avgRating =
      ratings.length > 0
        ? Math.round(ratings.reduce((sum, r) => sum + (r.rating ?? 0), 0) / ratings.length)
        : null;

    let ingredientNames: string[] = [];
    if (recipe.currentRevId) {
      const ings = await db
        .select({ name: schema.ingredients.name })
        .from(schema.ingredients)
        .where(eq(schema.ingredients.revisionId, recipe.currentRevId));
      ingredientNames = ings.map((i) => i.name);
    }

    // 表示用に解決する（DB は相対パス・旧データの絶対パスも貼り替わる）
    const heroPhotoUri = resolvePhotoUri(
      recipe.coverPhotoPath ?? (await getLatestCookingPhotoUri(db, schema, recipe.id)),
    );

    result.push({
      id: recipe.id,
      title: recipe.title,
      titleReading: recipe.titleReading,
      cookTimeMin,
      rating: avgRating,
      tags: tagRows.map((t) => t.name ?? '').filter(Boolean),
      ingredientNames,
      createdAt: recipe.createdAt,
      cookCount: ratingRows.length,
      heroPhotoUri,
      isCoverAiGenerated: isAiGeneratedPhoto(recipe.coverPhotoPath),
      pinnedAt: recipe.pinnedAt,
    });
  }

  return result;
}

// Latest cooking photo (cloud preferred, else local) for a recipe, or null.
async function getLatestCookingPhotoUri(
  db: Awaited<ReturnType<typeof getDb>>,
  schema: typeof DbSchema,
  recipeId: string,
): Promise<string | null> {
  const { eq, desc } = await import('drizzle-orm');
  const rows = await db
    .select({
      localPath: schema.cookingPhotos.localPath,
      cloudUrl: schema.cookingPhotos.cloudUrl,
    })
    .from(schema.cookingPhotos)
    .innerJoin(schema.cookingLogs, eq(schema.cookingPhotos.logId, schema.cookingLogs.id))
    .where(eq(schema.cookingLogs.recipeId, recipeId))
    .orderBy(desc(schema.cookingPhotos.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0].cloudUrl ?? resolvePhotoUri(rows[0].localPath);
}

export async function getRecipeDetail(recipeId: string): Promise<RecipeDetail | null> {
  if (!isNativePlatform) {
    return getMockRecipeDetail(recipeId);
  }

  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.recipes)
    .where(eq(schema.recipes.id, recipeId))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];

  if (shouldHideSeedRecipe(r.id)) return null;
  if (r.status === 'archived') return null;

  let servings: number | null = null;
  let cookTimeMin: number | null = null;
  let prepTimeMin: number | null = null;
  let description: string | null = null;

  if (r.currentRevId) {
    const revs = await db
      .select()
      .from(schema.recipeRevisions)
      .where(eq(schema.recipeRevisions.id, r.currentRevId))
      .limit(1);
    if (revs.length > 0) {
      servings = revs[0].servings;
      cookTimeMin = revs[0].cookTimeMin;
      prepTimeMin = revs[0].prepTimeMin;
      description = revs[0].description;
    }
  }

  const tagRows = await db
    .select({ name: schema.tags.name })
    .from(schema.recipeTags)
    .leftJoin(schema.tags, eq(schema.recipeTags.tagId, schema.tags.id))
    .where(eq(schema.recipeTags.recipeId, recipeId));

  const ratingRows = await db
    .select({ rating: schema.cookingLogs.rating })
    .from(schema.cookingLogs)
    .where(eq(schema.cookingLogs.recipeId, recipeId));
  const ratings = ratingRows.filter((x) => x.rating != null);
  const avgRating =
    ratings.length > 0
      ? Math.round(ratings.reduce((sum, x) => sum + (x.rating ?? 0), 0) / ratings.length)
      : null;

  let ingredientsList: RecipeDetail['ingredients'] = [];
  if (r.currentRevId) {
    ingredientsList = await db
      .select()
      .from(schema.ingredients)
      .where(eq(schema.ingredients.revisionId, r.currentRevId))
      .orderBy(schema.ingredients.sortOrder);
  }

  let stepsList: RecipeDetail['steps'] = [];
  if (r.currentRevId) {
    const stepRows = await db
      .select()
      .from(schema.steps)
      .where(eq(schema.steps.revisionId, r.currentRevId))
      .orderBy(schema.steps.sortOrder);
    // 手順写真も表示用に解決する（表紙と同じ理由 — photo-path.ts）
    stepsList = stepRows.map((step) => ({ ...step, photoPath: resolvePhotoUri(step.photoPath) }));
  }

  const heroPhotoUri = resolvePhotoUri(
    r.coverPhotoPath ?? (await getLatestCookingPhotoUri(db, schema, recipeId)),
  );

  return {
    id: r.id,
    title: r.title,
    // 編集画面がここを読まないと、開いて更新しただけで消える（#220）
    titleReading: r.titleReading,
    servings,
    cookTimeMin,
    prepTimeMin,
    description,
    rating: avgRating,
    tags: tagRows.map((t) => t.name ?? '').filter(Boolean),
    ingredients: ingredientsList,
    steps: stepsList,
    heroPhotoUri,
    coverPhotoPath: resolvePhotoUri(r.coverPhotoPath),
    // 判定は resolve 前の生パス（相対パス）で行う — ファイル名の接頭辞さえ
    // 見られればよく、resolve 後でも basename は同じなのでどちらでも結果は同じ
    isCoverAiGenerated: isAiGeneratedPhoto(r.coverPhotoPath),
    pinnedAt: r.pinnedAt,
    placeName: r.placeName,
  };
}

/** 作りたいリスト: ピン留めのオン/オフ（pinned_at = 日時 or null） */
/**
 * 手順写真をその場で付ける（料理中モード・レシピ詳細から。2026-08-28）。
 *
 * 編集フォームの全置換（updateRecipe）を通さない理由:
 * - **版を切らない。** 写真の添付は「レシピ内容の変更」ではなく調理の記録で、
 *   版履歴に「写真を付けた」だけの版が並ぶのはノイズ
 * - **同期も触らない。** `photoPath` は同期ペイロードに入れない設計
 *   （sync-payload.ts「写真は S3」）なので、updated_at を動かすと
 *   無内容の同期送信と LWW の上書きリスクだけが増える
 *
 * web は撮影 UI 自体を出さない（呼ばれても何もしない）。
 */
export async function setStepPhoto(stepId: string, photoPath: string | null): Promise<void> {
  if (!isNativePlatform) return;

  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  await db
    .update(schema.steps)
    .set({ photoPath: toStoredPhotoPath(photoPath) })
    .where(eq(schema.steps.id, stepId));
}

export async function setRecipePinned(recipeId: string, pinned: boolean): Promise<void> {
  if (!isNativePlatform) {
    setMockRecipePinned(recipeId, pinned);
    return;
  }

  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  // **同期には載せない。** 「今度これを作りたい」は人ごとの都合で、家族で 1 つに
  // 揃うものではない。加えて updated_at を進めると、1 タップのブックマークが
  // レシピ丸ごとのスナップショットを LWW で勝たせてしまい、オフライン端末の
  // ピン 1 回で他端末の編集が巻き戻る（docs/クラウド同期設計.md §5-1b）。
  await db
    .update(schema.recipes)
    .set({ pinnedAt: pinned ? nowIso() : null })
    .where(eq(schema.recipes.id, recipeId));
}

/** 作りたいリスト: ピン留め済みレシピ（新しくピンした順） */
export async function getWantToCookRecipes(): Promise<RecipeListItem[]> {
  const all = await getRecipeList();
  return all
    .filter((r) => r.pinnedAt != null)
    .sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''));
}

export async function searchRecipes(query: string): Promise<RecipeListItem[]> {
  const all = await getRecipeList();
  if (!query.trim()) return all;

  const aliases = await getAliasMap();
  return all.filter((r) => recipeMatchesQuery(r, query, aliases));
}

export async function getRecipeRevisions(recipeId: string): Promise<RecipeRevisionSummary[]> {
  if (!isNativePlatform) {
    return getMockRecipeRevisions(recipeId);
  }

  const { desc, eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const recipeRows = await db
    .select({
      id: schema.recipes.id,
      currentRevId: schema.recipes.currentRevId,
      status: schema.recipes.status,
    })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, recipeId))
    .limit(1);
  if (recipeRows.length === 0) return [];
  if (recipeRows[0].status === 'archived' || shouldHideSeedRecipe(recipeRows[0].id)) return [];

  const revisionRows = await db
    .select()
    .from(schema.recipeRevisions)
    .where(eq(schema.recipeRevisions.recipeId, recipeId))
    .orderBy(desc(schema.recipeRevisions.revisionNumber));

  const result: RecipeRevisionSummary[] = [];
  for (const revision of revisionRows) {
    const [ingredients, steps] = await Promise.all([
      db
        .select({ id: schema.ingredients.id })
        .from(schema.ingredients)
        .where(eq(schema.ingredients.revisionId, revision.id)),
      db
        .select({ id: schema.steps.id })
        .from(schema.steps)
        .where(eq(schema.steps.revisionId, revision.id)),
    ]);

    result.push({
      id: revision.id,
      recipeId: revision.recipeId,
      revisionNumber: revision.revisionNumber,
      isMajor: revision.isMajor,
      createdBy: revision.createdBy,
      createdAt: revision.createdAt,
      servings: revision.servings,
      cookTimeMin: revision.cookTimeMin,
      prepTimeMin: revision.prepTimeMin,
      description: revision.description,
      authorNote: revision.authorNote,
      sourceId: revision.sourceId,
      ingredientCount: ingredients.length,
      stepCount: steps.length,
      isCurrent: recipeRows[0].currentRevId === revision.id,
    });
  }

  return result;
}

export async function createRecipe(input: SaveRecipeInput): Promise<string> {
  if (!isNativePlatform) {
    return createMockRecipe(input);
  }

  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const recipeId = generateId();
  const revId = generateId();
  const now = nowIso();

  // Insert recipe
  await db.insert(schema.recipes).values({
    id: recipeId,
    familyId: FAMILY_ID,
    title: input.title,
    // 作成と更新で `''` の扱いを揃える（recipe-update.ts の規則）
    titleReading: blankToNull(input.titleReading) ?? null,
    currentRevId: revId,
    status: 'active',
    coverPhotoPath: toStoredPhotoPath(input.coverPhotoPath),
    placeName: blankToNull(input.placeName) ?? null,
    createdBy: USER_ID,
    createdAt: now,
    updatedAt: now,
  });

  // Insert revision
  await db.insert(schema.recipeRevisions).values({
    id: revId,
    recipeId,
    revisionNumber: 1,
    isMajor: true,
    servings: input.servings ?? null,
    cookTimeMin: input.cookTimeMin ?? null,
    prepTimeMin: input.prepTimeMin ?? null,
    description: input.description ?? null,
    authorNote: input.authorNote ?? null,
    sourceId: input.sourceId ?? null,
    createdBy: USER_ID,
    createdAt: now,
  });

  // Insert ingredients
  for (let i = 0; i < input.ingredients.length; i++) {
    const ing = input.ingredients[i];
    await db.insert(schema.ingredients).values({
      id: generateId(),
      revisionId: revId,
      sortOrder: i + 1,
      groupLabel: ing.groupLabel ?? null,
      name: ing.name,
      amount: ing.amount ?? null,
      note: ing.note ?? null,
    });
  }

  // Insert steps
  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i];
    await db.insert(schema.steps).values({
      id: generateId(),
      revisionId: revId,
      sortOrder: i + 1,
      body: step.body,
      timerSec: step.timerSec ?? null,
      photoId: null,
      photoPath: toStoredPhotoPath(step.photoPath),
    });
  }

  // Handle tags
  for (const tagName of input.tags) {
    await ensureTagLinked(db, schema, recipeId, tagName);
  }

  // Update FTS index
  await updateFtsForRecipe(recipeId, input);

  // 家族と共有中なら送信待ちへ（未参加なら積まれるだけで何も起きない）
  await enqueueSyncEntity(SYNC_ENTITY_RECIPE, recipeId);

  return recipeId;
}

/** Save a free-text memo (e.g. the user's impression) on a recipe. */
export async function createRecipeMemo(recipeId: string, body: string): Promise<string | null> {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (!isNativePlatform) return null;

  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const { getCurrentUser } = await import('./user.service');
  const db = getDb();
  const id = generateId();
  const now = nowIso();

  await db.insert(schema.memos).values({
    id,
    recipeId,
    authorId: getCurrentUser().id,
    body: trimmed,
    isPrivate: false,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Free-text memos (newest first) recorded on a recipe. */
export async function getMemosForRecipe(recipeId: string): Promise<MemoItem[]> {
  if (!isNativePlatform) return [];

  const { eq, desc } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const rows = await db
    .select({
      id: schema.memos.id,
      body: schema.memos.body,
      authorId: schema.memos.authorId,
      createdAt: schema.memos.createdAt,
    })
    .from(schema.memos)
    .where(eq(schema.memos.recipeId, recipeId))
    .orderBy(desc(schema.memos.createdAt));

  return rows;
}

export async function updateRecipe(recipeId: string, input: UpdateRecipeInput): Promise<string> {
  if (!isNativePlatform) {
    return updateMockRecipe(recipeId, input);
  }

  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  // Get current revision number
  const recipe = await db
    .select({
      currentRevId: schema.recipes.currentRevId,
      titleReading: schema.recipes.titleReading,
      coverPhotoPath: schema.recipes.coverPhotoPath,
      placeName: schema.recipes.placeName,
    })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, recipeId))
    .limit(1);

  if (recipe.length === 0) throw new Error('Recipe not found');

  let nextRevNum = 1;
  if (recipe[0].currentRevId) {
    const rev = await db
      .select({ revisionNumber: schema.recipeRevisions.revisionNumber })
      .from(schema.recipeRevisions)
      .where(eq(schema.recipeRevisions.id, recipe[0].currentRevId))
      .limit(1);
    if (rev.length > 0) nextRevNum = rev[0].revisionNumber + 1;
  }

  const revId = generateId();
  const now = nowIso();

  // **渡されなかった欄は現行値を引き継ぐ。** 規則の実体は services/recipe-update.ts
  // （mock と手写しで二重化すると、jest は mock 側しか通らないので実装だけ壊れても緑になる）
  const previousRev = recipe[0].currentRevId
    ? ((
        await db
          .select({
            sourceId: schema.recipeRevisions.sourceId,
            servings: schema.recipeRevisions.servings,
            cookTimeMin: schema.recipeRevisions.cookTimeMin,
            prepTimeMin: schema.recipeRevisions.prepTimeMin,
            description: schema.recipeRevisions.description,
          })
          .from(schema.recipeRevisions)
          .where(eq(schema.recipeRevisions.id, recipe[0].currentRevId))
          .limit(1)
      )[0] ?? null)
    : null;

  const next = resolveRecipeUpdate(input, {
    titleReading: recipe[0].titleReading,
    coverPhotoPath: recipe[0].coverPhotoPath,
    placeName: recipe[0].placeName,
    revision: previousRev,
  });

  // Insert new revision
  await db.insert(schema.recipeRevisions).values({
    id: revId,
    recipeId,
    revisionNumber: nextRevNum,
    isMajor: input.isMajor ?? true,
    servings: next.servings,
    cookTimeMin: next.cookTimeMin,
    prepTimeMin: next.prepTimeMin,
    description: next.description,
    // 版のメモは「この版で何を変えたか」なので引き継がない。渡されなければ無し
    authorNote: input.authorNote ?? null,
    sourceId: next.sourceId,
    createdBy: USER_ID,
    createdAt: now,
  });

  // Update recipe to point to new revision
  await db
    .update(schema.recipes)
    .set({
      title: input.title,
      titleReading: next.titleReading,
      currentRevId: revId,
      coverPhotoPath: next.coverPhotoPath,
      placeName: next.placeName,
      updatedAt: now,
    })
    .where(eq(schema.recipes.id, recipeId));

  // Insert ingredients for new revision
  for (let i = 0; i < input.ingredients.length; i++) {
    const ing = input.ingredients[i];
    await db.insert(schema.ingredients).values({
      id: generateId(),
      revisionId: revId,
      sortOrder: i + 1,
      groupLabel: ing.groupLabel ?? null,
      name: ing.name,
      amount: ing.amount ?? null,
      note: ing.note ?? null,
    });
  }

  // Insert steps for new revision
  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i];
    await db.insert(schema.steps).values({
      id: generateId(),
      revisionId: revId,
      sortOrder: i + 1,
      body: step.body,
      timerSec: step.timerSec ?? null,
      photoId: null,
      photoPath: toStoredPhotoPath(step.photoPath),
    });
  }

  // Update tags: remove old, add new
  await db.delete(schema.recipeTags).where(eq(schema.recipeTags.recipeId, recipeId));
  for (const tagName of input.tags) {
    await ensureTagLinked(db, schema, recipeId, tagName);
  }

  // Update FTS index。**引き継いだ読みがなを入れる**（input のままだと空で貼り直してしまう）
  await updateFtsForRecipe(recipeId, { ...input, titleReading: next.titleReading });

  await enqueueSyncEntity(SYNC_ENTITY_RECIPE, recipeId);

  return revId;
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  if (!isNativePlatform) {
    deleteMockRecipe(recipeId);
    return;
  }

  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  await db
    .update(schema.recipes)
    .set({ status: 'archived', updatedAt: nowIso() })
    .where(eq(schema.recipes.id, recipeId));

  // Remove from FTS
  try {
    const { getExpoDb } = await import('../db/client');
    const expoDb = getExpoDb();
    expoDb.runSync('DELETE FROM recipe_fts WHERE recipe_id = ?', [recipeId]);
  } catch {
    // FTS table may not exist yet
  }

  // 削除は論理削除（status='archived'）。同期でも行は消さず archived を配る
  await enqueueSyncEntity(SYNC_ENTITY_RECIPE, recipeId);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function ensureTagLinked(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { select: (...args: any[]) => any; insert: (...args: any[]) => any },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  recipeId: string,
  tagName: string,
): Promise<void> {
  const { eq, and } = await import('drizzle-orm');

  // Find or create tag
  const existing = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.familyId, FAMILY_ID), eq(schema.tags.name, tagName)))
    .limit(1);

  let tagId: string;
  if (existing.length > 0) {
    tagId = existing[0].id;
  } else {
    tagId = generateId();
    await db.insert(schema.tags).values({
      id: tagId,
      familyId: FAMILY_ID,
      name: tagName,
      color: null,
    });
  }

  // Link tag to recipe
  await db.insert(schema.recipeTags).values({
    recipeId,
    tagId,
  });
}

/** FTS が要るのは 3 つだけ。作成・更新のどちらの入力型でも渡せるように絞ってある */
async function updateFtsForRecipe(
  recipeId: string,
  input: {
    title: string;
    titleReading?: string | null;
    ingredients: { name: string }[];
  },
): Promise<void> {
  try {
    const { getExpoDb } = await import('../db/client');
    const expoDb = getExpoDb();
    const ingredientNames = input.ingredients.map((i) => i.name).join(' ');

    // Delete existing entry
    expoDb.runSync('DELETE FROM recipe_fts WHERE recipe_id = ?', [recipeId]);

    // Insert updated entry
    expoDb.runSync(
      'INSERT INTO recipe_fts (recipe_id, title, title_reading, ingredient_names) VALUES (?, ?, ?, ?)',
      [recipeId, input.title, input.titleReading ?? '', ingredientNames],
    );
  } catch {
    // FTS table may not exist yet on first run
  }
}
