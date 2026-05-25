/**
 * CookingLog service — create cooking records and fetch per-recipe history
 */
import { isNativePlatform } from '../db/client';
import { shouldHideSeedCookingLog } from '../db/sampleData';
import { createMockCookingLog, getMockCookingLogsForRecipe, getMockTimeline } from '../db/mock';
import type {
  CookingLogEntry,
  CookingPhotoItem,
  SaveCookingLogInput,
  TimelineEntry,
} from './types';

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

function validateCookingLogInput(input: SaveCookingLogInput): void {
  if (
    input.rating != null &&
    (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
  ) {
    throw new RangeError('rating must be an integer between 1 and 5');
  }
  if (
    input.servings != null &&
    (!Number.isInteger(input.servings) || input.servings < 1 || input.servings > 99)
  ) {
    throw new RangeError('servings must be an integer between 1 and 99');
  }
  if (input.memo != null && input.memo.length > 500) {
    throw new RangeError('memo must be 500 characters or fewer');
  }
  if (Number.isNaN(Date.parse(input.cookedAt))) {
    throw new RangeError('cookedAt must be an ISO-compatible datetime');
  }
}

export async function createCookingLog(input: SaveCookingLogInput): Promise<string> {
  validateCookingLogInput(input);

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
    servings: input.servings ?? null,
    rating: input.rating ?? null,
    memo: input.memo ?? null,
    createdAt: now,
  });

  if (input.photos && input.photos.length > 0) {
    await db.insert(schema.cookingPhotos).values(
      input.photos.map((photo, index) => ({
        id: generateId(),
        logId: id,
        localPath: photo.localPath,
        cloudUrl: photo.cloudUrl ?? null,
        sortOrder: index + 1,
        takenAt: photo.takenAt ?? null,
        createdAt: now,
      })),
    );
  }

  return id;
}

export async function getLogsForRecipe(recipeId: string): Promise<CookingLogEntry[]> {
  if (!isNativePlatform) {
    return getMockCookingLogsForRecipe(recipeId);
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
      userName: schema.users.displayName,
      cookedAt: schema.cookingLogs.cookedAt,
      servings: schema.cookingLogs.servings,
      rating: schema.cookingLogs.rating,
      memo: schema.cookingLogs.memo,
    })
    .from(schema.cookingLogs)
    .leftJoin(schema.recipes, eq(schema.cookingLogs.recipeId, schema.recipes.id))
    .leftJoin(schema.users, eq(schema.cookingLogs.cookedBy, schema.users.id))
    .where(eq(schema.cookingLogs.recipeId, recipeId))
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
      recipeId: l.recipeId,
      recipeTitle: l.recipeTitle ?? 'フリー記録',
      userName: l.userName ?? '不明',
      cookedAt: l.cookedAt,
      servings: l.servings,
      rating: l.rating,
      memo: l.memo,
      photos: (photosByLogId.get(l.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}

export async function getTimeline(): Promise<TimelineEntry[]> {
  if (!isNativePlatform) {
    return getMockTimeline();
  }

  const { getDb } = await import('../db/client');
  const { eq, inArray } = await import('drizzle-orm');
  const schema = await import('../db/schema');
  const db = getDb();

  const logs = await db
    .select({
      id: schema.cookingLogs.id,
      recipeId: schema.cookingLogs.recipeId,
      recipeTitle: schema.recipes.title,
      userName: schema.users.displayName,
      cookedAt: schema.cookingLogs.cookedAt,
      servings: schema.cookingLogs.servings,
      rating: schema.cookingLogs.rating,
      memo: schema.cookingLogs.memo,
    })
    .from(schema.cookingLogs)
    .leftJoin(schema.recipes, eq(schema.cookingLogs.recipeId, schema.recipes.id))
    .leftJoin(schema.users, eq(schema.cookingLogs.cookedBy, schema.users.id));

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
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt))
    .map((l) => ({
      id: l.id,
      recipeId: l.recipeId,
      recipeTitle: l.recipeTitle ?? 'フリー記録',
      userName: l.userName ?? '不明',
      cookedAt: l.cookedAt,
      servings: l.servings,
      rating: l.rating,
      memo: l.memo,
      photos: (photosByLogId.get(l.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}
