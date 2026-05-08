/**
 * Timeline service — data access for home screen cooking logs
 */
import { isNativePlatform } from '../db/client';
import { getMockTimeline } from '../db/mock';
import type { TimelineEntry } from './types';

export async function getTimeline(): Promise<TimelineEntry[]> {
  if (!isNativePlatform) {
    return getMockTimeline();
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
