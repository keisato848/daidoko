/**
 * レシピ帖（S4 — docs/Web共有設計.md §7）。
 *
 * 帖はローカルの実体（recipe_books / recipe_book_items）。共有は任意の後続で、
 * 共有済みの帖は削除トークンを編集トークンとして PATCH し、**slug（＝配った
 * リンク）を変えずに**中身を差し替えられる。
 *
 * 「権限」は人ベースではなくリンクの強度（パスコード6桁・有効期限）。
 * パスコードは更新時に再送するため平文で保存する（端末内 SQLite のみ・
 * 端末外に出るのはハッシュだけ）。
 */
import { API_V1 } from '../config';
import { isNativePlatform } from '../db/client';
import { getLocale } from '../i18n';
import { generateId } from '../utils/id';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { getRecipeDetail } from './recipe.service';
import { SYNC_ENTITY_RECIPE_BOOK } from './sync-payload';
import { enqueueSyncEntity } from './sync-queue.service';
import {
  buildShareRecipeBody,
  getUrlImportedRecipeIds,
  readShareTimePhoto,
} from './web-share.service';

export interface ShareAccessOptions {
  /**
   * 数字6桁。null = 保護なし。**新規発行・変更時のみ 6 桁を強制**（#269）。
   * 既に 4 桁で公開済みの帖は、入力側（消費画面）が 4 桁も受け付けるので
   * そのまま開ける — ハッシュ照合は桁数を見ないため
   */
  passcode: string | null;
  /** null = 無期限 */
  expiresInDays: 7 | 30 | null;
}

export interface RecipeBookListItem {
  id: string;
  title: string;
  recipeCount: number;
  updatedAt: string;
  shareUrl: string | null;
  sharedAt: string | null;
  isLegacyShare: boolean;
  passcode: string | null;
  expiresAt: string | null;
}

export interface RecipeBookDetail extends RecipeBookListItem {
  shareSlug: string | null;
  items: { recipeId: string; title: string; excluded: boolean }[];
}

function nowIso(): string {
  return new Date().toISOString();
}

async function db() {
  const { getDb } = await import('../db/client');
  return getDb();
}

async function schema() {
  return import('../db/schema');
}

// ── ローカル CRUD ────────────────────────────────────────────────────────────

export async function createRecipeBook(title: string, recipeIds: string[]): Promise<string> {
  const database = await db();
  const { recipeBooks, recipeBookItems } = await schema();
  const id = generateId();
  const now = nowIso();
  await database.insert(recipeBooks).values({ id, title, createdAt: now, updatedAt: now });
  for (const [position, recipeId] of recipeIds.entries()) {
    await database.insert(recipeBookItems).values({ bookId: id, recipeId, position });
  }
  await enqueueSyncEntity(SYNC_ENTITY_RECIPE_BOOK, id);
  return id;
}

export async function getRecipeBooks(): Promise<RecipeBookListItem[]> {
  if (!isNativePlatform) return [];
  const database = await db();
  const { recipeBooks, recipeBookItems } = await schema();
  const { desc, eq } = await import('drizzle-orm');
  const rows = await database.select().from(recipeBooks).orderBy(desc(recipeBooks.updatedAt));
  const result: RecipeBookListItem[] = [];
  for (const row of rows) {
    const items = await database
      .select({ recipeId: recipeBookItems.recipeId })
      .from(recipeBookItems)
      .where(eq(recipeBookItems.bookId, row.id));
    result.push({
      id: row.id,
      title: row.title,
      recipeCount: items.length,
      updatedAt: row.updatedAt,
      shareUrl: row.shareUrl,
      sharedAt: row.sharedAt,
      isLegacyShare: row.isLegacyShare === 1,
      passcode: row.sharePasscode,
      expiresAt: row.shareExpiresAt,
    });
  }
  return result;
}

export async function getRecipeBook(id: string): Promise<RecipeBookDetail | null> {
  const database = await db();
  const { recipeBooks, recipeBookItems, recipes } = await schema();
  const { asc, eq } = await import('drizzle-orm');
  const rows = await database.select().from(recipeBooks).where(eq(recipeBooks.id, id));
  const row = rows[0];
  if (!row) return null;
  const items = await database
    .select({ recipeId: recipeBookItems.recipeId, title: recipes.title })
    .from(recipeBookItems)
    .leftJoin(recipes, eq(recipeBookItems.recipeId, recipes.id))
    .where(eq(recipeBookItems.bookId, id))
    .orderBy(asc(recipeBookItems.position));
  const urlImported = await getUrlImportedRecipeIds();
  return {
    id: row.id,
    title: row.title,
    recipeCount: items.length,
    updatedAt: row.updatedAt,
    shareUrl: row.shareUrl,
    sharedAt: row.sharedAt,
    isLegacyShare: row.isLegacyShare === 1,
    passcode: row.sharePasscode,
    expiresAt: row.shareExpiresAt,
    shareSlug: row.shareSlug,
    items: items.map((i) => ({
      recipeId: i.recipeId,
      title: i.title ?? '',
      excluded: urlImported.has(i.recipeId),
    })),
  };
}

export async function renameRecipeBook(id: string, title: string): Promise<void> {
  const database = await db();
  const { recipeBooks } = await schema();
  const { eq } = await import('drizzle-orm');
  await database
    .update(recipeBooks)
    .set({ title, updatedAt: nowIso() })
    .where(eq(recipeBooks.id, id));
  await enqueueSyncEntity(SYNC_ENTITY_RECIPE_BOOK, id);
}

export async function setBookRecipes(id: string, recipeIds: string[]): Promise<void> {
  const database = await db();
  const { recipeBooks, recipeBookItems } = await schema();
  const { eq } = await import('drizzle-orm');
  await database.delete(recipeBookItems).where(eq(recipeBookItems.bookId, id));
  for (const [position, recipeId] of recipeIds.entries()) {
    await database.insert(recipeBookItems).values({ bookId: id, recipeId, position });
  }
  await database.update(recipeBooks).set({ updatedAt: nowIso() }).where(eq(recipeBooks.id, id));
  await enqueueSyncEntity(SYNC_ENTITY_RECIPE_BOOK, id);
}

/** 帖を削除する。共有中なら先に停止を試みる（失敗しても削除は続行） */
export async function deleteRecipeBook(id: string): Promise<void> {
  const book = await getRecipeBook(id);
  if (book?.shareSlug) {
    await revokeSharedBook(id).catch(() => undefined);
  }
  const database = await db();
  const { recipeBooks, recipeBookItems } = await schema();
  const { eq } = await import('drizzle-orm');
  await database.delete(recipeBookItems).where(eq(recipeBookItems.bookId, id));
  await database.delete(recipeBooks).where(eq(recipeBooks.id, id));
  // 帖は物理削除。送信時に行が無いことを見て tombstone になる（sync-entities.service）
  await enqueueSyncEntity(SYNC_ENTITY_RECIPE_BOOK, id);
}

// ── 共有（S4-1: リンク不変の更新 / S4-2: 公開の強度）────────────────────────

interface ShareServerResponse {
  ok?: boolean;
  slug?: string;
  url?: string;
  deleteToken?: string;
  expiresAt?: string | null;
  error?: { message?: string };
}

/** 出所ゲート（URL 取り込みは除外）を通った収録レシピの送信ボディを組む */
async function buildBookRecipeBodies(
  recipeIds: string[],
): Promise<{ bodies: Record<string, unknown>[]; excludedCount: number }> {
  const urlImported = await getUrlImportedRecipeIds();
  const bodies: Record<string, unknown>[] = [];
  let excludedCount = 0;
  for (const recipeId of recipeIds) {
    if (urlImported.has(recipeId)) {
      excludedCount += 1;
      continue;
    }
    const detail = await getRecipeDetail(recipeId);
    if (!detail) continue;
    const body: Record<string, unknown> = buildShareRecipeBody(detail);
    const photoBase64 = await readShareTimePhoto(detail);
    if (photoBase64) {
      body['photoBase64'] = photoBase64;
      body['photoMime'] = 'image/jpeg';
    }
    bodies.push(body);
  }
  return { bodies, excludedCount };
}

/**
 * 帖を共有する（未共有 → POST・共有済み → PATCH で同じリンクのまま反映）。
 * attested はクライアントの確認ダイアログを通った証跡（呼び出し側が担保）。
 */
export async function shareRecipeBook(id: string, access: ShareAccessOptions): Promise<void> {
  const book = await getRecipeBook(id);
  if (!book) throw new Error('book not found');
  const { bodies } = await buildBookRecipeBodies(book.items.map((i) => i.recipeId));
  if (bodies.length === 0) throw new Error('no shareable recipes');

  const payload = {
    attested: true,
    locale: getLocale(),
    title: book.title,
    recipes: bodies,
    passcode: access.passcode,
    expiresInDays: access.expiresInDays,
  };

  const isUpdate = book.shareSlug !== null && !book.isLegacyShare;
  const database = await db();
  const { recipeBooks } = await schema();
  const { eq } = await import('drizzle-orm');

  if (isUpdate) {
    const tokenRows = await database
      .select({ token: recipeBooks.shareDeleteToken })
      .from(recipeBooks)
      .where(eq(recipeBooks.id, id));
    const token = tokenRows[0]?.token;
    if (!token) throw new Error('missing share token');
    const res = await fetch(`${API_V1}/share/books/${book.shareSlug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-share-delete-token': token },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as ShareServerResponse | null;
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error?.message ?? `book update failed (${res.status})`);
    }
    // **updatedAt は触らない。** 共有は帖の内容の変更ではないうえ、ここで進めると
    // 同期の LWW の時計だけがローカルで先へ行き、他端末の収録追加が無視される
    // （しかも同期には積まないのでサーバーの時計は進まない）。
    await database
      .update(recipeBooks)
      .set({
        sharePasscode: access.passcode,
        shareExpiresAt: json.expiresAt ?? null,
        shareLocale: getLocale(),
      })
      .where(eq(recipeBooks.id, id));
    return;
  }

  const res = await fetch(`${API_V1}/share/books`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => null)) as ShareServerResponse | null;
  if (!res.ok || !json?.ok || !json.slug || !json.url || !json.deleteToken) {
    throw new Error(json?.error?.message ?? `book share failed (${res.status})`);
  }
  await database
    .update(recipeBooks)
    .set({
      shareSlug: json.slug,
      shareUrl: json.url,
      shareDeleteToken: json.deleteToken,
      sharedAt: nowIso(),
      shareLocale: getLocale(),
      sharePasscode: access.passcode,
      shareExpiresAt: json.expiresAt ?? null,
      isLegacyShare: 0,
    })
    .where(eq(recipeBooks.id, id));
}

/** 共有を停止する。サーバー 404（既に消えている）でもローカルの共有状態は消す */
export async function revokeSharedBook(id: string): Promise<void> {
  const database = await db();
  const { recipeBooks } = await schema();
  const { eq } = await import('drizzle-orm');
  const rows = await database.select().from(recipeBooks).where(eq(recipeBooks.id, id));
  const row = rows[0];
  if (!row?.shareSlug || !row.shareDeleteToken) return;
  const res = await fetch(`${API_V1}/share/books/${row.shareSlug}`, {
    method: 'DELETE',
    headers: { 'x-share-delete-token': row.shareDeleteToken },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`book revoke failed (${res.status})`);
  }
  await database
    .update(recipeBooks)
    .set({
      shareSlug: null,
      shareUrl: null,
      shareDeleteToken: null,
      sharedAt: null,
      shareLocale: null,
      sharePasscode: null,
      shareExpiresAt: null,
      isLegacyShare: 0,
    })
    .where(eq(recipeBooks.id, id));
}

// ── S2 からの移行 ────────────────────────────────────────────────────────────
// app_meta.web_share_books の控えを recipe_books に写す。収録レシピは記録が
// 無いので items は空・is_legacy_share=1（停止のみ可）。黙って消さないための措置。

const LEGACY_BOOKS_KEY = 'web_share_books';

export async function migrateLegacyWebShareBooks(): Promise<void> {
  if (!isNativePlatform) return;
  const raw = await getAppMeta(LEGACY_BOOKS_KEY);
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = [];
  }
  const database = await db();
  const { recipeBooks } = await schema();
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as {
        slug?: string;
        url?: string;
        deleteToken?: string;
        title?: string;
        sharedAt?: string;
      };
      if (!e.slug || !e.url || !e.deleteToken) continue;
      await database.insert(recipeBooks).values({
        id: generateId(),
        title: e.title ?? 'Book',
        createdAt: e.sharedAt ?? nowIso(),
        updatedAt: e.sharedAt ?? nowIso(),
        shareSlug: e.slug,
        shareUrl: e.url,
        shareDeleteToken: e.deleteToken,
        sharedAt: e.sharedAt ?? nowIso(),
        isLegacyShare: 1,
      });
    }
  }
  await setAppMeta(LEGACY_BOOKS_KEY, '');
}
