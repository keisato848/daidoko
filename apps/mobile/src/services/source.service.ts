/**
 * Source service — metadata for imported recipes.
 */
import { isNativePlatform } from '../db/client';
import { createMockOcrSource } from '../db/mock';
import { generateId } from '../utils/id';

export interface CreateOcrSourceInput {
  rawText: string;
  capturedAt?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function createOcrSource(input: CreateOcrSourceInput): Promise<string> {
  if (!isNativePlatform) {
    return createMockOcrSource(input);
  }

  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();
  const id = generateId();
  const now = nowIso();

  await db.insert(schema.sources).values({
    id,
    type: 'ocr',
    url: null,
    ocrRawText: input.rawText,
    siteName: null,
    pageTitle: null,
    thumbnailUrl: null,
    capturedAt: input.capturedAt ?? now,
    createdAt: now,
  });

  return id;
}
