/**
 * Source service — metadata for imported recipes.
 */
import { isNativePlatform } from '../db/client';
import { createMockOcrSource, createMockPhotoSource } from '../db/mock';
import { generateId } from '../utils/id';
import { t } from '../i18n';

export interface CreateOcrSourceInput {
  rawText: string;
  capturedAt?: string;
}

export interface CreatePhotoSourceInput {
  labelSummary?: string;
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

export interface CreateUrlSourceInput {
  url: string;
  siteName?: string;
}

/**
 * URL 取り込みの出所記録。Web 共有の出所ゲート（docs/Web共有設計.md §2-2）が
 * この type='url' を見て共有ボタンを封じる — 他サイト由来の内容をサーバーに置かないための証跡。
 */
/**
 * 共有リンク（/r/:slug・/b/:slug）から取り込んだレシピの出所（#198）。
 *
 * `type = 'share'` にする。Web 共有の出所ゲートは `'url'` だけを見るので、家族から
 * 受け取ったレシピは**再共有できる**（自分で作った内容を家族が作り直したものと同じ扱い）。
 * 他サイトの転載を受け取った可能性はあるが、共有した側が「自分で作成した」と証跡
 * （attested）を出しているので、そこで担保する。
 */
export async function createShareSource(input: {
  url: string;
  pageTitle?: string;
}): Promise<string> {
  if (!isNativePlatform) return generateId();
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const id = generateId();
  await getDb()
    .insert(schema.sources)
    .values({
      id,
      type: 'share',
      url: input.url,
      ocrRawText: null,
      siteName: null,
      pageTitle: input.pageTitle ?? null,
      thumbnailUrl: null,
      capturedAt: nowIso(),
      createdAt: nowIso(),
    });
  return id;
}

export async function createUrlSource(input: CreateUrlSourceInput): Promise<string> {
  if (!isNativePlatform) {
    // Web(モック)環境では出所テーブルが無い — 記録なしで進める（共有ゲートは attestation が担保）
    return generateId();
  }

  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();
  const id = generateId();
  const now = nowIso();

  await db.insert(schema.sources).values({
    id,
    type: 'url',
    url: input.url,
    ocrRawText: null,
    siteName: input.siteName ?? null,
    pageTitle: null,
    thumbnailUrl: null,
    capturedAt: now,
    createdAt: now,
  });

  return id;
}

export async function createPhotoSource(input: CreatePhotoSourceInput): Promise<string> {
  if (!isNativePlatform) {
    return createMockPhotoSource(input);
  }

  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();
  const id = generateId();
  const now = nowIso();

  await db.insert(schema.sources).values({
    id,
    type: 'photo',
    url: null,
    ocrRawText: input.labelSummary ?? null,
    siteName: null,
    pageTitle: t('recipe.photo.tabLabel'),
    thumbnailUrl: null,
    capturedAt: input.capturedAt ?? now,
    createdAt: now,
  });

  return id;
}
