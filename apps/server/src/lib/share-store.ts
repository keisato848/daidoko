/**
 * Web 共有（レシピ共有リンク）の永続化。docs/Web共有設計.md。
 *
 * このサーバー初の永続ストレージ。Railway ボリューム（/data）上の SQLite を
 * better-sqlite3 + Drizzle で読み書きする。Postgres にしない理由は設計書 §3
 * （月数十円で済む・サービスが増えない・#65 で移行可能）。
 *
 * - slug は暗号乱数 12 文字（base64url）— これが「限定公開」の鍵。列挙不可能
 * - 取り消しトークンは SHA-256 ハッシュのみ保存（平文は発行時に返し、端末にだけ残る）
 * - 取り消しは soft delete（revoked_at）。ページ・写真とも 404 になる
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const sharedRecipes = sqliteTable('shared_recipes', {
  slug: text('slug').primaryKey(),
  deleteTokenHash: text('delete_token_hash').notNull(),
  locale: text('locale').notNull(),
  title: text('title').notNull(),
  servings: integer('servings'),
  cookTimeMin: integer('cook_time_min'),
  description: text('description'),
  /** JSON: { name, amount?, note?, groupLabel? }[] */
  ingredientsJson: text('ingredients_json').notNull(),
  /** JSON: { body }[] */
  stepsJson: text('steps_json').notNull(),
  /** JSON: string[] */
  tagsJson: text('tags_json').notNull(),
  photo: blob('photo', { mode: 'buffer' }),
  photoMime: text('photo_mime'),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
});

export type SharedRecipeRow = typeof sharedRecipes.$inferSelect;

// ── レシピ帖（S2）: 複数レシピのスナップショットを 1 ページに ─────────────────
// 帖は自己完結（公開時点のコピーを保持）。取り消しは帖ごと。

export const sharedBooks = sqliteTable('shared_books', {
  slug: text('slug').primaryKey(),
  deleteTokenHash: text('delete_token_hash').notNull(),
  locale: text('locale').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
});

export const sharedBookRecipes = sqliteTable('shared_book_recipes', {
  bookSlug: text('book_slug').notNull(),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  servings: integer('servings'),
  cookTimeMin: integer('cook_time_min'),
  description: text('description'),
  ingredientsJson: text('ingredients_json').notNull(),
  stepsJson: text('steps_json').notNull(),
  tagsJson: text('tags_json').notNull(),
  photo: blob('photo', { mode: 'buffer' }),
  photoMime: text('photo_mime'),
});

export type SharedBookRow = typeof sharedBooks.$inferSelect;
export type SharedBookRecipeRow = typeof sharedBookRecipes.$inferSelect;

// DDL は定数文字列（動的組み立てなし）。1 テーブルなので drizzle-kit の
// マイグレーション管理は持たず、起動時の CREATE IF NOT EXISTS で足りる。
const DDL = `
CREATE TABLE IF NOT EXISTS shared_recipes (
  slug              TEXT PRIMARY KEY,
  delete_token_hash TEXT NOT NULL,
  locale            TEXT NOT NULL,
  title             TEXT NOT NULL,
  servings          INTEGER,
  cook_time_min     INTEGER,
  description       TEXT,
  ingredients_json  TEXT NOT NULL,
  steps_json        TEXT NOT NULL,
  tags_json         TEXT NOT NULL,
  photo             BLOB,
  photo_mime        TEXT,
  created_at        TEXT NOT NULL,
  revoked_at        TEXT
);
CREATE TABLE IF NOT EXISTS shared_books (
  slug              TEXT PRIMARY KEY,
  delete_token_hash TEXT NOT NULL,
  locale            TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  created_at        TEXT NOT NULL,
  revoked_at        TEXT
);
CREATE TABLE IF NOT EXISTS shared_book_recipes (
  book_slug         TEXT NOT NULL,
  position          INTEGER NOT NULL,
  title             TEXT NOT NULL,
  servings          INTEGER,
  cook_time_min     INTEGER,
  description       TEXT,
  ingredients_json  TEXT NOT NULL,
  steps_json        TEXT NOT NULL,
  tags_json         TEXT NOT NULL,
  photo             BLOB,
  photo_mime        TEXT,
  PRIMARY KEY (book_slug, position)
);
`;

function resolveDbPath(): string {
  const fromEnv = process.env['SHARE_DB_PATH'];
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  // Railway ではボリュームを /data にマウントする。無ければローカル開発
  if (fs.existsSync('/data')) return '/data/share.db';
  return path.join('.data', 'share.db');
}

let dbSingleton: BetterSQLite3Database | null = null;

export function getShareDb(): BetterSQLite3Database {
  if (dbSingleton) return dbSingleton;
  const dbPath = resolveDbPath();
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(DDL);
  dbSingleton = drizzle(sqlite);
  return dbSingleton;
}

/** テスト用: シングルトンを破棄（SHARE_DB_PATH=':memory:' と組で使う） */
export function resetShareDbForTesting(): void {
  dbSingleton = null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreateShareInput {
  locale: 'ja' | 'en';
  title: string;
  servings?: number | undefined;
  cookTimeMin?: number | undefined;
  description?: string | undefined;
  ingredients: {
    name: string;
    amount?: string | undefined;
    note?: string | undefined;
    groupLabel?: string | undefined;
  }[];
  steps: { body: string }[];
  tags: string[];
  photo?: { data: Buffer; mime: string } | undefined;
}

export interface CreateShareResult {
  slug: string;
  deleteToken: string;
}

export function createShare(input: CreateShareInput): CreateShareResult {
  const db = getShareDb();
  const slug = randomBytes(9).toString('base64url'); // 12 文字・72bit — 総当たり不可能
  const deleteToken = randomBytes(24).toString('base64url');
  db.insert(sharedRecipes)
    .values({
      slug,
      deleteTokenHash: hashToken(deleteToken),
      locale: input.locale,
      title: input.title,
      servings: input.servings ?? null,
      cookTimeMin: input.cookTimeMin ?? null,
      description: input.description ?? null,
      ingredientsJson: JSON.stringify(input.ingredients),
      stepsJson: JSON.stringify(input.steps),
      tagsJson: JSON.stringify(input.tags),
      photo: input.photo?.data ?? null,
      photoMime: input.photo?.mime ?? null,
      createdAt: new Date().toISOString(),
    })
    .run();
  return { slug, deleteToken };
}

/** 取り消し済みは返さない（404 と同じ扱い — 存在を漏らさない） */
export function getActiveShare(slug: string): SharedRecipeRow | null {
  const db = getShareDb();
  const rows = db
    .select()
    .from(sharedRecipes)
    .where(and(eq(sharedRecipes.slug, slug), isNull(sharedRecipes.revokedAt)))
    .all();
  return rows[0] ?? null;
}

export type RevokeResult = 'revoked' | 'not-found' | 'forbidden';

export function revokeShare(slug: string, deleteToken: string): RevokeResult {
  const db = getShareDb();
  const rows = db.select().from(sharedRecipes).where(eq(sharedRecipes.slug, slug)).all();
  const row = rows[0];
  if (!row || row.revokedAt) return 'not-found';
  const expected = Buffer.from(row.deleteTokenHash, 'hex');
  const actual = Buffer.from(hashToken(deleteToken), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return 'forbidden';
  db.update(sharedRecipes)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(sharedRecipes.slug, slug))
    .run();
  return 'revoked';
}

// ── レシピ帖 ─────────────────────────────────────────────────────────────────

export interface CreateBookShareInput {
  locale: 'ja' | 'en';
  title: string;
  description?: string | undefined;
  recipes: {
    title: string;
    servings?: number | undefined;
    cookTimeMin?: number | undefined;
    description?: string | undefined;
    ingredients: {
      name: string;
      amount?: string | undefined;
      note?: string | undefined;
      groupLabel?: string | undefined;
    }[];
    steps: { body: string }[];
    tags: string[];
    photo?: { data: Buffer; mime: string } | undefined;
  }[];
}

export function createBookShare(input: CreateBookShareInput): CreateShareResult {
  const db = getShareDb();
  const slug = randomBytes(9).toString('base64url');
  const deleteToken = randomBytes(24).toString('base64url');
  db.insert(sharedBooks)
    .values({
      slug,
      deleteTokenHash: hashToken(deleteToken),
      locale: input.locale,
      title: input.title,
      description: input.description ?? null,
      createdAt: new Date().toISOString(),
    })
    .run();
  input.recipes.forEach((recipe, position) => {
    db.insert(sharedBookRecipes)
      .values({
        bookSlug: slug,
        position,
        title: recipe.title,
        servings: recipe.servings ?? null,
        cookTimeMin: recipe.cookTimeMin ?? null,
        description: recipe.description ?? null,
        ingredientsJson: JSON.stringify(recipe.ingredients),
        stepsJson: JSON.stringify(recipe.steps),
        tagsJson: JSON.stringify(recipe.tags),
        photo: recipe.photo?.data ?? null,
        photoMime: recipe.photo?.mime ?? null,
      })
      .run();
  });
  return { slug, deleteToken };
}

export function getActiveBook(
  slug: string,
): { book: SharedBookRow; recipes: SharedBookRecipeRow[] } | null {
  const db = getShareDb();
  const books = db
    .select()
    .from(sharedBooks)
    .where(and(eq(sharedBooks.slug, slug), isNull(sharedBooks.revokedAt)))
    .all();
  const book = books[0];
  if (!book) return null;
  const recipes = db
    .select()
    .from(sharedBookRecipes)
    .where(eq(sharedBookRecipes.bookSlug, slug))
    .orderBy(sharedBookRecipes.position)
    .all();
  return { book, recipes };
}

export function revokeBookShare(slug: string, deleteToken: string): RevokeResult {
  const db = getShareDb();
  const rows = db.select().from(sharedBooks).where(eq(sharedBooks.slug, slug)).all();
  const row = rows[0];
  if (!row || row.revokedAt) return 'not-found';
  const expected = Buffer.from(row.deleteTokenHash, 'hex');
  const actual = Buffer.from(hashToken(deleteToken), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return 'forbidden';
  db.update(sharedBooks)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(sharedBooks.slug, slug))
    .run();
  return 'revoked';
}

/** バックアップ用の全件ダンプ（取り消し済みも含む — 復元のため） */
export function exportAllShares(): (Omit<SharedRecipeRow, 'photo'> & {
  photoBase64: string | null;
})[] {
  const db = getShareDb();
  return db
    .select()
    .from(sharedRecipes)
    .all()
    .map(({ photo, ...rest }) => ({
      ...rest,
      photoBase64: photo ? photo.toString('base64') : null,
    }));
}

export function exportAllBooks(): (SharedBookRow & {
  recipes: (Omit<SharedBookRecipeRow, 'photo'> & { photoBase64: string | null })[];
})[] {
  const db = getShareDb();
  const books = db.select().from(sharedBooks).all();
  return books.map((book) => ({
    ...book,
    recipes: db
      .select()
      .from(sharedBookRecipes)
      .where(eq(sharedBookRecipes.bookSlug, book.slug))
      .orderBy(sharedBookRecipes.position)
      .all()
      .map(({ photo, ...rest }) => ({
        ...rest,
        photoBase64: photo ? photo.toString('base64') : null,
      })),
  }));
}
