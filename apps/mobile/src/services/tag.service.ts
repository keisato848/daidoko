/**
 * Tag service — data access for family tags
 */
import { isNativePlatform } from '../db/client';
import { getMockTags } from '../db/mock';
import { generateId } from '../utils/id';
import type { TagItem } from './types';

const FAMILY_ID = 'family-001';

export async function getTagsForFamily(): Promise<TagItem[]> {
  if (!isNativePlatform) {
    return getMockTags();
  }

  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const rows = await db
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      color: schema.tags.color,
    })
    .from(schema.tags)
    .where(eq(schema.tags.familyId, FAMILY_ID));

  return rows;
}

export async function upsertTags(tagNames: string[]): Promise<TagItem[]> {
  if (!isNativePlatform) {
    return tagNames.map((name) => ({ id: generateId(), name, color: null }));
  }

  const { eq, and } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const result: TagItem[] = [];

  for (const name of tagNames) {
    const existing = await db
      .select({ id: schema.tags.id, name: schema.tags.name, color: schema.tags.color })
      .from(schema.tags)
      .where(and(eq(schema.tags.familyId, FAMILY_ID), eq(schema.tags.name, name)))
      .limit(1);

    if (existing.length > 0) {
      result.push(existing[0]);
    } else {
      const id = generateId();
      await db.insert(schema.tags).values({
        id,
        familyId: FAMILY_ID,
        name,
        color: null,
      });
      result.push({ id, name, color: null });
    }
  }

  return result;
}
