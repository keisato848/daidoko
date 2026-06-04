/**
 * Recipe service — centralized data access for recipe CRUD operations
 * Handles both native (SQLite) and web (mock) data paths
 */
import { isNativePlatform } from '../db/client';
import { shouldHideSeedRecipe } from '../db/sampleData';
import {
  getMockRecipeDetail,
  getMockRecipeList,
  getMockRecipeRevisions,
  createMockRecipe,
  updateMockRecipe,
  deleteMockRecipe,
} from '../db/mock';
import { generateId } from '../utils/id';
import type {
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
      currentRevId: schema.recipes.currentRevId,
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

    result.push({
      id: recipe.id,
      title: recipe.title,
      cookTimeMin,
      rating: avgRating,
      tags: tagRows.map((t) => t.name ?? '').filter(Boolean),
      ingredientNames,
    });
  }

  return result;
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
    stepsList = await db
      .select()
      .from(schema.steps)
      .where(eq(schema.steps.revisionId, r.currentRevId))
      .orderBy(schema.steps.sortOrder);
  }

  return {
    id: r.id,
    title: r.title,
    servings,
    cookTimeMin,
    description,
    rating: avgRating,
    tags: tagRows.map((t) => t.name ?? '').filter(Boolean),
    ingredients: ingredientsList,
    steps: stepsList,
  };
}

export async function searchRecipes(query: string): Promise<RecipeListItem[]> {
  const all = await getRecipeList();
  if (!query.trim()) return all;

  const q = query.trim().toLowerCase();
  return all.filter(
    (r) =>
      r.title.toLowerCase().includes(q) ||
      r.tags.some((t) => t.includes(q)) ||
      r.ingredientNames.some((name) => name.includes(q)),
  );
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
    titleReading: input.titleReading ?? null,
    currentRevId: revId,
    status: 'active',
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
    });
  }

  // Handle tags
  for (const tagName of input.tags) {
    await ensureTagLinked(db, schema, recipeId, tagName);
  }

  // Update FTS index
  await updateFtsForRecipe(recipeId, input);

  return recipeId;
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
    .select({ currentRevId: schema.recipes.currentRevId })
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

  // Insert new revision
  await db.insert(schema.recipeRevisions).values({
    id: revId,
    recipeId,
    revisionNumber: nextRevNum,
    isMajor: input.isMajor ?? true,
    servings: input.servings ?? null,
    cookTimeMin: input.cookTimeMin ?? null,
    prepTimeMin: input.prepTimeMin ?? null,
    description: input.description ?? null,
    authorNote: input.authorNote ?? null,
    sourceId: input.sourceId ?? null,
    createdBy: USER_ID,
    createdAt: now,
  });

  // Update recipe to point to new revision
  await db
    .update(schema.recipes)
    .set({
      title: input.title,
      titleReading: input.titleReading ?? null,
      currentRevId: revId,
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
    });
  }

  // Update tags: remove old, add new
  await db.delete(schema.recipeTags).where(eq(schema.recipeTags.recipeId, recipeId));
  for (const tagName of input.tags) {
    await ensureTagLinked(db, schema, recipeId, tagName);
  }

  // Update FTS index
  await updateFtsForRecipe(recipeId, input);

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

async function updateFtsForRecipe(recipeId: string, input: SaveRecipeInput): Promise<void> {
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
