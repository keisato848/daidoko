/**
 * Timeline service — data access for home screen cooking logs
 */
import { isNativePlatform } from '../db/client';
import { shouldHideSeedCookingLog } from '../db/sampleData';
import { getMockTimeline } from '../db/mock';
import type { CookingPhotoItem, TimelineEntry } from './types';

function groupPhotosByLogId(
  photos: (CookingPhotoItem & { logId: string })[],
): Map<string, CookingPhotoItem[]> {
  const grouped = new Map<string, CookingPhotoItem[]>();
  for (const { logId, ...photo } of photos) {
    const current = grouped.get(logId) ?? [];
    current.push(photo);
    grouped.set(logId, current);
  }
  return grouped;
}

export async function getTimeline(): Promise<TimelineEntry[]> {
  if (!isNativePlatform) {
    return getMockTimeline();
  }

  const { eq, inArray } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const logs = await db
    .select({
      id: schema.cookingLogs.id,
      recipeId: schema.cookingLogs.recipeId,
      recipeTitle: schema.recipes.title,
      recipeStatus: schema.recipes.status,
      userName: schema.users.displayName,
      cookedAt: schema.cookingLogs.cookedAt,
      servings: schema.cookingLogs.servings,
      rating: schema.cookingLogs.rating,
      memo: schema.cookingLogs.memo,
    })
    .from(schema.cookingLogs)
    .leftJoin(schema.recipes, eq(schema.cookingLogs.recipeId, schema.recipes.id))
    .leftJoin(schema.users, eq(schema.cookingLogs.cookedBy, schema.users.id))
    .orderBy(schema.cookingLogs.cookedAt);

  const photoRows =
    logs.length > 0
      ? await db
          .select({
            id: schema.cookingPhotos.id,
            logId: schema.cookingPhotos.logId,
            localPath: schema.cookingPhotos.localPath,
            cloudUrl: schema.cookingPhotos.cloudUrl,
            sortOrder: schema.cookingPhotos.sortOrder,
            takenAt: schema.cookingPhotos.takenAt,
            createdAt: schema.cookingPhotos.createdAt,
          })
          .from(schema.cookingPhotos)
          .where(
            inArray(
              schema.cookingPhotos.logId,
              logs.map((log) => log.id),
            ),
          )
      : [];
  const photosByLogId = groupPhotosByLogId(photoRows);

  return logs
    .filter((log) => !shouldHideSeedCookingLog(log.id, log.recipeId))
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt))
    .map((l) => ({
      id: l.id,
      recipeId: l.recipeStatus === 'archived' ? null : l.recipeId,
      recipeTitle: l.recipeTitle ?? 'フリー記録',
      userName: l.userName ?? '不明',
      cookedAt: l.cookedAt,
      servings: l.servings,
      rating: l.rating,
      memo: l.memo,
      photos: (photosByLogId.get(l.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}
