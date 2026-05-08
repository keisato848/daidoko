/**
 * CookingLog service — create cooking records and fetch per-recipe history
 */
import { isNativePlatform } from '../db/client';
import { createMockCookingLog, getMockCookingLogsForRecipe, getMockTimeline } from '../db/mock';
import type { CookingLogEntry, SaveCookingLogInput, TimelineEntry } from './types';

export async function createCookingLog(input: SaveCookingLogInput): Promise<string> {
  if (!isNativePlatform) {
    return createMockCookingLog(input);
  }

  const { generateId } = await import('../utils/id');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const id = generateId();
  const now = new Date().toISOString();

  const { getCurrentUser, getCurrentFamily } = await import('./user.service');
  const user = getCurrentUser();
  const family = getCurrentFamily();

  await db.insert(schema.cookingLogs).values({
    id,
    familyId: family.id,
    recipeId: input.recipeId ?? null,
    cookedBy: user.id,
    cookedAt: input.cookedAt,
    rating: input.rating ?? null,
    memo: input.memo ?? null,
    createdAt: now,
  });

  return id;
}

export async function getLogsForRecipe(recipeId: string): Promise<CookingLogEntry[]> {
  if (!isNativePlatform) {
    return getMockCookingLogsForRecipe(recipeId);
  }

  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const logs = await db
    .select({
      id: schema.cookingLogs.id,
      recipeId: schema.cookingLogs.recipeId,
      recipeTitle: schema.recipes.title,
      userName: schema.users.displayName,
      cookedAt: schema.cookingLogs.cookedAt,
      rating: schema.cookingLogs.rating,
      memo: schema.cookingLogs.memo,
    })
    .from(schema.cookingLogs)
    .leftJoin(schema.recipes, eq(schema.cookingLogs.recipeId, schema.recipes.id))
    .leftJoin(schema.users, eq(schema.cookingLogs.cookedBy, schema.users.id))
    .where(eq(schema.cookingLogs.recipeId, recipeId))
    .orderBy(schema.cookingLogs.cookedAt);

  return logs
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt))
    .map((l) => ({
      id: l.id,
      recipeId: l.recipeId,
      recipeTitle: l.recipeTitle ?? 'フリー記録',
      userName: l.userName ?? '不明',
      cookedAt: l.cookedAt,
      rating: l.rating,
      memo: l.memo,
    }));
}

export async function getTimeline(): Promise<TimelineEntry[]> {
  if (!isNativePlatform) {
    return getMockTimeline();
  }

  const { getDb } = await import('../db/client');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../db/schema');
  const db = getDb();

  const logs = await db
    .select({
      id: schema.cookingLogs.id,
      recipeId: schema.cookingLogs.recipeId,
      recipeTitle: schema.recipes.title,
      userName: schema.users.displayName,
      cookedAt: schema.cookingLogs.cookedAt,
      rating: schema.cookingLogs.rating,
      memo: schema.cookingLogs.memo,
    })
    .from(schema.cookingLogs)
    .leftJoin(schema.recipes, eq(schema.cookingLogs.recipeId, schema.recipes.id))
    .leftJoin(schema.users, eq(schema.cookingLogs.cookedBy, schema.users.id));

  return logs
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt))
    .map((l) => ({
      id: l.id,
      recipeId: l.recipeId,
      recipeTitle: l.recipeTitle ?? 'フリー記録',
      userName: l.userName ?? '不明',
      cookedAt: l.cookedAt,
      rating: l.rating,
      memo: l.memo,
    }));
}
