/**
 * Web 共有 — レシピ共有リンク（docs/Web共有設計.md）。
 *
 * アプリなしでも読めるレシピページを発行し、URL を OS の共有シートで渡す。
 * 家族（iPhone）や SNS への共有で、受け手がアプリを入れられなくても断線しない。
 *
 * - 出所ゲート: URL 取り込み由来（sources.type='url'）のレシピは共有できない。
 *   全リビジョンを見る（編集で出所が消える抜け道を塞ぐ）
 * - 共有状態は app_meta `web_share:<recipeId>` に JSON で保存
 *   （deleteToken は端末外に出さない。取り消しに必要）
 */
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { getAppMeta, setAppMeta } from './app-meta.service';
import type { RecipeDetail } from './types';
import { API_V1 } from '../config';
import { isNativePlatform } from '../db/client';
import { getLocale } from '../i18n';

/** Web 共有ページの写真は表示幅が最大 640px — 1200px あれば Retina でも十分 */
const SHARE_PHOTO_MAX_DIMENSION = 1200;
const SHARE_PHOTO_QUALITY = 0.7;

export interface WebShareRecord {
  slug: string;
  url: string;
  deleteToken: string;
  sharedAt: string;
}

export type WebShareBlockReason = 'url-import';

const META_PREFIX = 'web_share:';
/**
 * 同期で届いたレシピが URL 取り込み由来であることの印（値は '1'）。
 * 受信側は現在のリビジョンの出所しか持たないので、古いリビジョンだけが URL 由来の
 * レシピはこの印が無いとゲートをすり抜ける（sync-entities.service 参照）。
 */
export const URL_IMPORTED_META_PREFIX = 'url_imported:';

// ── 出所ゲート ───────────────────────────────────────────────────────────────

/** 純粋な判定（テスト対象）: いずれかのリビジョンが URL 取り込み由来なら共有不可 */
export function shareBlockReasonForSourceTypes(
  types: readonly (string | null)[],
): WebShareBlockReason | null {
  return types.includes('url') ? 'url-import' : null;
}

export async function getShareBlockReason(recipeId: string): Promise<WebShareBlockReason | null> {
  if (!isNativePlatform) return null; // Web(モック)環境は出所テーブルなし — attestation が担保
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();
  const rows = await db
    .select({ type: schema.sources.type })
    .from(schema.recipeRevisions)
    .innerJoin(schema.sources, eq(schema.recipeRevisions.sourceId, schema.sources.id))
    .where(eq(schema.recipeRevisions.recipeId, recipeId));
  const types: (string | null)[] = rows.map((r) => r.type);
  // 同期で届いた印も出所として数える（出所行が無くても URL 由来なら共有不可）
  if ((await getAppMeta(URL_IMPORTED_META_PREFIX + recipeId)) === '1') types.push('url');
  return shareBlockReasonForSourceTypes(types);
}

/** レシピ帖の選択画面用: URL 取り込み由来のレシピ ID を一括で取る（1 クエリ） */
export async function getUrlImportedRecipeIds(): Promise<Set<string>> {
  if (!isNativePlatform) return new Set();
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();
  const rows = await db
    .select({ recipeId: schema.recipeRevisions.recipeId })
    .from(schema.recipeRevisions)
    .innerJoin(schema.sources, eq(schema.recipeRevisions.sourceId, schema.sources.id))
    .where(eq(schema.sources.type, 'url'));
  const ids = new Set(rows.map((r) => r.recipeId));
  // 同期で届いた印（app_meta の url_imported:<recipeId>）
  const { like } = await import('drizzle-orm');
  const marks = await db
    .select({ key: schema.appMeta.key })
    .from(schema.appMeta)
    .where(like(schema.appMeta.key, `${URL_IMPORTED_META_PREFIX}%`));
  for (const mark of marks) ids.add(mark.key.slice(URL_IMPORTED_META_PREFIX.length));
  return ids;
}

// ── 共有状態（app_meta） ─────────────────────────────────────────────────────

export async function getWebShare(recipeId: string): Promise<WebShareRecord | null> {
  const raw = await getAppMeta(META_PREFIX + recipeId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WebShareRecord>;
    if (parsed.slug && parsed.url && parsed.deleteToken) return parsed as WebShareRecord;
    return null;
  } catch {
    return null;
  }
}

async function clearWebShare(recipeId: string): Promise<void> {
  await setAppMeta(META_PREFIX + recipeId, '');
}

// ── 公開ペイロード ───────────────────────────────────────────────────────────

export interface SharePayload {
  attested: true;
  locale: 'ja' | 'en';
  title: string;
  servings?: number;
  cookTimeMin?: number;
  description?: string;
  ingredients: { name: string; amount?: string; note?: string; groupLabel?: string }[];
  steps: { body: string }[];
  tags: string[];
  photoBase64?: string;
  photoMime?: 'image/jpeg';
}

/** レシピ 1 件ぶんの本文（単品共有と帖で共通）。純粋（テスト対象） */
export function buildShareRecipeBody(
  recipe: RecipeDetail,
): Omit<SharePayload, 'attested' | 'locale'> {
  return {
    title: recipe.title,
    ...(recipe.servings != null ? { servings: recipe.servings } : {}),
    ...(recipe.cookTimeMin != null ? { cookTimeMin: recipe.cookTimeMin } : {}),
    ...(recipe.description?.trim() ? { description: recipe.description.trim() } : {}),
    ingredients: recipe.ingredients.map((ing) => ({
      name: ing.name,
      ...(ing.amount ? { amount: ing.amount } : {}),
      ...(ing.note ? { note: ing.note } : {}),
      ...(ing.groupLabel ? { groupLabel: ing.groupLabel } : {}),
    })),
    steps: recipe.steps.map((step) => ({ body: step.body })),
    tags: recipe.tags,
  };
}

/** 純粋な組み立て（テスト対象）。attested はここで固定 — 確認ダイアログを通った後にのみ呼ぶ */
export function buildSharePayload(recipe: RecipeDetail, locale: 'ja' | 'en'): SharePayload {
  return { attested: true, locale, ...buildShareRecipeBody(recipe) };
}

/** 表紙（無ければヒーロー）写真を Web 用に縮小して base64 で返す。失敗したら写真なしで進む */
export async function readShareTimePhoto(recipe: RecipeDetail): Promise<string | null> {
  const uri = recipe.coverPhotoPath ?? recipe.heroPhotoUri;
  if (!uri) return null;
  try {
    const context = ImageManipulator.manipulate(uri);
    const original = await context.renderAsync();
    if (Math.max(original.width, original.height) > SHARE_PHOTO_MAX_DIMENSION) {
      context.resize(
        original.width >= original.height
          ? { width: SHARE_PHOTO_MAX_DIMENSION }
          : { height: SHARE_PHOTO_MAX_DIMENSION },
      );
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: SHARE_PHOTO_QUALITY,
    });
    return await FileSystem.readAsStringAsync(saved.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    return null; // 写真は任意 — 読めなければテキストだけで共有する
  }
}

// ── 公開・取り消し ───────────────────────────────────────────────────────────

export async function publishRecipeToWeb(recipe: RecipeDetail): Promise<WebShareRecord> {
  const payload = buildSharePayload(recipe, getLocale());
  const photoBase64 = await readShareTimePhoto(recipe);
  if (photoBase64) {
    payload.photoBase64 = photoBase64;
    payload.photoMime = 'image/jpeg';
  }

  const res = await fetch(`${API_V1}/share/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    slug?: string;
    url?: string;
    deleteToken?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok || !json?.ok || !json.slug || !json.url || !json.deleteToken) {
    throw new Error(json?.error?.message ?? `share failed (${res.status})`);
  }

  const record: WebShareRecord = {
    slug: json.slug,
    url: json.url,
    deleteToken: json.deleteToken,
    sharedAt: new Date().toISOString(),
  };
  await setAppMeta(META_PREFIX + recipe.id, JSON.stringify(record));
  return record;
}

// ── レシピ帖（S2） ──────────────────────────────────────────────────────────

const BOOKS_META_KEY = 'web_share_books';

export interface WebShareBookRecord {
  slug: string;
  url: string;
  deleteToken: string;
  title: string;
  recipeCount: number;
  sharedAt: string;
}

export async function getWebShareBooks(): Promise<WebShareBookRecord[]> {
  const raw = await getAppMeta(BOOKS_META_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b): b is WebShareBookRecord =>
        typeof b === 'object' && b !== null && 'slug' in b && 'url' in b && 'deleteToken' in b,
    );
  } catch {
    return [];
  }
}

async function saveWebShareBooks(books: WebShareBookRecord[]): Promise<void> {
  await setAppMeta(BOOKS_META_KEY, JSON.stringify(books));
}

/** 帖を公開する。写真は各レシピの表紙（あれば）を縮小して同送 */
export async function publishRecipeBookToWeb(
  title: string,
  recipes: RecipeDetail[],
): Promise<WebShareBookRecord> {
  const recipeBodies = [];
  for (const recipe of recipes) {
    const body: Record<string, unknown> = buildShareRecipeBody(recipe);
    const photoBase64 = await readShareTimePhoto(recipe);
    if (photoBase64) {
      body['photoBase64'] = photoBase64;
      body['photoMime'] = 'image/jpeg';
    }
    recipeBodies.push(body);
  }

  const res = await fetch(`${API_V1}/share/books`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attested: true, locale: getLocale(), title, recipes: recipeBodies }),
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    slug?: string;
    url?: string;
    deleteToken?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok || !json?.ok || !json.slug || !json.url || !json.deleteToken) {
    throw new Error(json?.error?.message ?? `book share failed (${res.status})`);
  }

  const record: WebShareBookRecord = {
    slug: json.slug,
    url: json.url,
    deleteToken: json.deleteToken,
    title,
    recipeCount: recipes.length,
    sharedAt: new Date().toISOString(),
  };
  await saveWebShareBooks([record, ...(await getWebShareBooks())]);
  return record;
}

/** 帖の共有を取り消す。サーバー 404 でもローカル一覧からは消す */
export async function revokeWebShareBook(slug: string): Promise<void> {
  const books = await getWebShareBooks();
  const record = books.find((b) => b.slug === slug);
  if (!record) return;
  const res = await fetch(`${API_V1}/share/books/${slug}`, {
    method: 'DELETE',
    headers: { 'x-share-delete-token': record.deleteToken },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`book revoke failed (${res.status})`);
  }
  await saveWebShareBooks(books.filter((b) => b.slug !== slug));
}

/**
 * 共有を取り消す。サーバーが 404（既に消えている）でもローカル状態は掃除する。
 * ネットワーク失敗時は throw — 状態を残して後で再試行できるようにする。
 */
export async function revokeWebShare(recipeId: string): Promise<void> {
  const record = await getWebShare(recipeId);
  if (!record) return;
  const res = await fetch(`${API_V1}/share/recipes/${record.slug}`, {
    method: 'DELETE',
    headers: { 'x-share-delete-token': record.deleteToken },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`revoke failed (${res.status})`);
  }
  await clearWebShare(recipeId);
}
