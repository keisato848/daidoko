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
  /**
   * 表紙が AI 生成イメージか（docs/レシピ表紙AI生成設計.md §4）。0/1 の INTEGER
   * （SQLite に BOOLEAN 型は無い）。既存行は列追加時に NULL → falsy 扱い。
   */
  coverIsAiGenerated: integer('cover_is_ai_generated'),
  /**
   * 中身（材料・手順）を AI が推定したレシピか（#266）。表紙の AI とは**別の意味**。
   * 0/1 の INTEGER。既存行は列追加時に NULL → falsy 扱い（＝不明であって「人が書いた」ではない）。
   */
  aiGenerated: integer('ai_generated'),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
  /**
   * 受け取り期限（ISO・docs/共有設計.md §3-6）。**リンクを新しく開ける期限**であって、
   * ページ自体の期限ではない — 期限内に開いた閲覧者はアクセス Cookie で以後も見られる。
   * NULL は旧データのみ（起動時に埋める）。
   */
  expiresAt: text('expires_at'),
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
  /**
   * 受け取り期限（ISO）。S4-2 では「超えたら 404」の完全失効だったが、
   * docs/共有設計.md §3-6 で**新規閲覧の期限**に意味を変えた（期限内に開いた人は
   * アクセス Cookie で以後も見られる）。判定はルート側で行う。
   */
  expiresAt: text('expires_at'),
  /** パスコード（数字6桁）の SHA-256(slug + ':' + passcode)。NULL = 保護なし（S4-2） */
  passcodeHash: text('passcode_hash'),
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
  /** 表紙が AI 生成イメージか（設計 §4）。レシピ単品と同じく 0/1 の INTEGER。 */
  coverIsAiGenerated: integer('cover_is_ai_generated'),
  /** 中身が AI 由来か（#266）。レシピ単品と同じ。 */
  aiGenerated: integer('ai_generated'),
});

export type SharedBookRow = typeof sharedBooks.$inferSelect;
export type SharedBookRecipeRow = typeof sharedBookRecipes.$inferSelect;

/** 少量の永続設定（アクセス Cookie の署名鍵など）。閲覧者の記録には使わない */
export const shareMeta = sqliteTable('share_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

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
  cover_is_ai_generated INTEGER,
  ai_generated      INTEGER,
  created_at        TEXT NOT NULL,
  revoked_at        TEXT,
  expires_at        TEXT
);
CREATE TABLE IF NOT EXISTS share_meta (
  key               TEXT PRIMARY KEY,
  value             TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shared_books (
  slug              TEXT PRIMARY KEY,
  delete_token_hash TEXT NOT NULL,
  locale            TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  created_at        TEXT NOT NULL,
  revoked_at        TEXT,
  expires_at        TEXT,
  passcode_hash     TEXT
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
  cover_is_ai_generated INTEGER,
  ai_generated      INTEGER,
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
  // 既存 DB への追い付き（CREATE IF NOT EXISTS は列を足せない）。冪等
  const bookCols = (sqlite.pragma('table_info(shared_books)') as { name: string }[]).map(
    (c) => c.name,
  );
  if (!bookCols.includes('expires_at')) {
    sqlite.exec('ALTER TABLE shared_books ADD COLUMN expires_at TEXT');
  }
  if (!bookCols.includes('passcode_hash')) {
    sqlite.exec('ALTER TABLE shared_books ADD COLUMN passcode_hash TEXT');
  }
  // レシピ表紙 AI 生成のラベル（docs/レシピ表紙AI生成設計.md §4）。既存 DB へ追い付き
  const recipeCols = (sqlite.pragma('table_info(shared_recipes)') as { name: string }[]).map(
    (c) => c.name,
  );
  if (!recipeCols.includes('cover_is_ai_generated')) {
    sqlite.exec('ALTER TABLE shared_recipes ADD COLUMN cover_is_ai_generated INTEGER');
  }
  // 中身が AI 由来かのラベル（#266）。同じく既存 DB へ追い付き
  if (!recipeCols.includes('ai_generated')) {
    sqlite.exec('ALTER TABLE shared_recipes ADD COLUMN ai_generated INTEGER');
  }
  const bookRecipeCols = (
    sqlite.pragma('table_info(shared_book_recipes)') as { name: string }[]
  ).map((c) => c.name);
  if (!bookRecipeCols.includes('cover_is_ai_generated')) {
    sqlite.exec('ALTER TABLE shared_book_recipes ADD COLUMN cover_is_ai_generated INTEGER');
  }
  if (!bookRecipeCols.includes('ai_generated')) {
    sqlite.exec('ALTER TABLE shared_book_recipes ADD COLUMN ai_generated INTEGER');
  }
  // 受け取り期限（docs/共有設計.md §3-6）。既存 DB へ追い付き＋既存行の埋め立て:
  // 無期限リンクを残さないため、NULL の行は「今から 7 日」を入れる（それまでに
  // 開いた閲覧者はアクセス Cookie で以後も見られる。開かなかった URL は失効）
  if (!recipeCols.includes('expires_at')) {
    sqlite.exec('ALTER TABLE shared_recipes ADD COLUMN expires_at TEXT');
  }
  const backfill = new Date(Date.now() + RECEIVE_WINDOW_MS).toISOString();
  sqlite.prepare('UPDATE shared_recipes SET expires_at = ? WHERE expires_at IS NULL').run(backfill);
  sqlite.prepare('UPDATE shared_books SET expires_at = ? WHERE expires_at IS NULL').run(backfill);
  dbSingleton = drizzle(sqlite);
  return dbSingleton;
}

/** 受け取り期限の窓（docs/共有設計.md §3-6）: リンクを新しく開ける期間 */
export const RECEIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function receiveWindowEnd(now = Date.now()): string {
  return new Date(now + RECEIVE_WINDOW_MS).toISOString();
}

/** 受け取り期限内か（NULL は起動時に埋めるので通常来ないが、来たら開ける側に倒す） */
export function withinReceiveWindow(expiresAt: string | null): boolean {
  return expiresAt == null || new Date().toISOString() <= expiresAt;
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
  /** 表紙が AI 生成イメージか（設計 §4）。省略可 — 省略/false は保存しない（NULL のまま）。 */
  coverIsAiGenerated?: boolean | undefined;
  aiGenerated?: boolean | undefined;
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
      coverIsAiGenerated: input.coverIsAiGenerated ? 1 : null,
      aiGenerated: input.aiGenerated ? 1 : null,
      expiresAt: receiveWindowEnd(),
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

export type RenewResult = 'renewed' | 'not-found' | 'forbidden';

/**
 * 受け取り期限を「今から 7 日」に張り直す（§3-6）。オーナーが「リンクを送る」たびに
 * 呼ばれる — 送る意思がある間だけ窓が開き、送らなくなった URL は自然に閉じる。
 */
export function renewShare(slug: string, deleteToken: string): RenewResult {
  const db = getShareDb();
  const rows = db.select().from(sharedRecipes).where(eq(sharedRecipes.slug, slug)).all();
  const row = rows[0];
  if (!row || row.revokedAt) return 'not-found';
  const expected = Buffer.from(row.deleteTokenHash, 'hex');
  const actual = Buffer.from(hashToken(deleteToken), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return 'forbidden';
  db.update(sharedRecipes)
    .set({ expiresAt: receiveWindowEnd() })
    .where(eq(sharedRecipes.slug, slug))
    .run();
  return 'renewed';
}

export function renewBookShare(slug: string, deleteToken: string): RenewResult {
  const db = getShareDb();
  const rows = db.select().from(sharedBooks).where(eq(sharedBooks.slug, slug)).all();
  const row = rows[0];
  if (!row || row.revokedAt) return 'not-found';
  const expected = Buffer.from(row.deleteTokenHash, 'hex');
  const actual = Buffer.from(hashToken(deleteToken), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return 'forbidden';
  db.update(sharedBooks)
    .set({ expiresAt: receiveWindowEnd() })
    .where(eq(sharedBooks.slug, slug))
    .run();
  return 'renewed';
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
    /** 表紙が AI 生成イメージか（設計 §4）。省略可。 */
    coverIsAiGenerated?: boolean | undefined;
    aiGenerated?: boolean | undefined;
  }[];
}

/** slug をソルトにする（同じ 4 桁でも帖ごとにハッシュが変わる） */
function hashPasscode(slug: string, passcode: string): string {
  return createHash('sha256').update(`${slug}:${passcode}`).digest('hex');
}

/** 期限・パスコードの公開設定（S4-2）。undefined = 指定なし（新規は無し扱い） */
export interface ShareAccessInput {
  expiresAt?: string | null | undefined;
  passcode?: string | null | undefined;
}

export function createBookShare(
  input: CreateBookShareInput,
  access: ShareAccessInput = {},
): CreateShareResult {
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
      // 受け取り期限は最長 7 日（§3-6）。クライアントがより短い期限を指定したらそちら
      expiresAt:
        access.expiresAt && access.expiresAt < receiveWindowEnd()
          ? access.expiresAt
          : receiveWindowEnd(),
      passcodeHash: access.passcode ? hashPasscode(slug, access.passcode) : null,
    })
    .run();
  insertBookRecipes(db, slug, input.recipes);
  return { slug, deleteToken };
}

function insertBookRecipes(
  db: BetterSQLite3Database,
  slug: string,
  recipes: CreateBookShareInput['recipes'],
): void {
  recipes.forEach((recipe, position) => {
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
        coverIsAiGenerated: recipe.coverIsAiGenerated ? 1 : null,
        aiGenerated: recipe.aiGenerated ? 1 : null,
      })
      .run();
  });
}

export type UpdateBookResult = 'updated' | 'not-found' | 'forbidden';

/**
 * 帖の中身をまるごと差し替える（S4）。slug と削除トークンは不変 —
 * 配ったリンクを生かしたまま育てられるのがこの API の目的。
 * 差分更新はしない（単純さを取る）。
 */
export function updateBookShare(
  slug: string,
  deleteToken: string,
  input: CreateBookShareInput,
  access: ShareAccessInput = {},
): UpdateBookResult {
  const db = getShareDb();
  const rows = db.select().from(sharedBooks).where(eq(sharedBooks.slug, slug)).all();
  const row = rows[0];
  if (!row || row.revokedAt) return 'not-found';
  const expected = Buffer.from(row.deleteTokenHash, 'hex');
  const actual = Buffer.from(hashToken(deleteToken), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return 'forbidden';
  db.update(sharedBooks)
    .set({
      locale: input.locale,
      title: input.title,
      description: input.description ?? null,
      // 更新も「送り直し」— 受け取り期限を最長 7 日で張り直す（§3-6。無期限には戻さない）
      expiresAt:
        access.expiresAt && access.expiresAt < receiveWindowEnd()
          ? access.expiresAt
          : receiveWindowEnd(),
      passcodeHash: access.passcode ? hashPasscode(slug, access.passcode) : null,
    })
    .where(eq(sharedBooks.slug, slug))
    .run();
  db.delete(sharedBookRecipes).where(eq(sharedBookRecipes.bookSlug, slug)).run();
  insertBookRecipes(db, slug, input.recipes);
  return 'updated';
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
  // 期限は 404 にしない（§3-6 で「新規閲覧の期限」に変更 — 判定はルート側。
  // 期限後もアクセス Cookie を持つ閲覧者には見せる必要があるため、行はそのまま返す）
  const recipes = db
    .select()
    .from(sharedBookRecipes)
    .where(eq(sharedBookRecipes.bookSlug, slug))
    .orderBy(sharedBookRecipes.position)
    .all();
  return { book, recipes };
}

// ── パスコード検証（S4-2）─────────────────────────────────────────────────────
// 6 桁 = 100 万通り。4 桁（1 万通り）だと 5 回/15 分のレート制限があっても
// 平均 10 日ほどで総当たりされる計算だったので、桁を増やして底上げした
// （100 万通りなら平均 2 か月・最悪 4 か月）。DB でロック状態を永続化する案もあるが、
// 採らない（意図的な判断）。slug ごとに失敗を数えてロックする。
// カウンタはメモリ（再起動でリセット — 許容。ロック時間より再起動間隔の方が長い）
//
// **この関数（hashPasscode/verifyBookPasscode）自体は桁数を見ない** — 渡された
// 文字列をそのままハッシュ・比較するだけ。既に 4 桁で公開済みの帖のパスコードも
// そのまま通る。6 桁必須は新規発行（`createBookSchema`/`patchBookSchema` の zod）
// だけが強制する。入力ゲート（JSON API・HTML の unlock フォーム）も 4 桁を
// 弾かないよう揃えてある（routes/share.ts・share-page.ts）

const PASSCODE_MAX_FAILS = 5;
const PASSCODE_LOCK_MS = 15 * 60 * 1000;
const passcodeFails = new Map<string, { count: number; lockedUntil: number }>();

export type PasscodeCheck = 'ok' | 'wrong' | 'locked';

export function verifyBookPasscode(slug: string, passcode: string): PasscodeCheck {
  const now = Date.now();
  const state = passcodeFails.get(slug);
  if (state && state.lockedUntil > now) return 'locked';
  const book = getActiveBook(slug)?.book;
  if (!book?.passcodeHash) return 'wrong';
  const expected = Buffer.from(book.passcodeHash, 'hex');
  const actual = Buffer.from(hashPasscode(slug, passcode), 'hex');
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (ok) {
    passcodeFails.delete(slug);
    return 'ok';
  }
  const count = (state?.count ?? 0) + 1;
  passcodeFails.set(slug, {
    count,
    lockedUntil: count >= PASSCODE_MAX_FAILS ? now + PASSCODE_LOCK_MS : 0,
  });
  return 'wrong';
}

/** テスト用: ロックカウンタを破棄 */
export function resetPasscodeFailsForTesting(): void {
  passcodeFails.clear();
}

// 認証済み Cookie の署名。プロセス毎の使い捨て鍵（再起動で再入力 — 許容・設定不要）
const cookieSecret = randomBytes(32);

export function makeBookCookie(slug: string): string {
  const book = getActiveBook(slug)?.book;
  return createHash('sha256')
    .update(cookieSecret)
    .update(`${slug}:${book?.passcodeHash ?? ''}`)
    .digest('base64url');
}

/** パスコード変更で古い Cookie が自動失効する（ハッシュを署名対象に含むため） */
export function verifyBookCookie(slug: string, cookie: string | undefined): boolean {
  if (!cookie) return false;
  const expected = makeBookCookie(slug);
  const a = Buffer.from(expected);
  const b = Buffer.from(cookie);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── アクセス Cookie（受け取り期限・§3-6） ────────────────────────────────────
// 期限内に開いた閲覧者へ渡す「開いた証明」。**再起動をまたいで有効である必要がある**
// （パスコード Cookie と違い、失効＝閲覧者の恒久的な締め出しになる）ので、
// 鍵はプロセス乱数ではなく share_meta に永続化する。閲覧者が誰かは記録しない
// （Cookie は閲覧者のブラウザにだけ残る — Web共有設計 §0-2 の方針のまま）。

const ACCESS_SECRET_KEY = 'access_cookie_secret';
let accessSecretCache: string | null = null;

function getAccessCookieSecret(): string {
  if (accessSecretCache) return accessSecretCache;
  const db = getShareDb();
  const rows = db.select().from(shareMeta).where(eq(shareMeta.key, ACCESS_SECRET_KEY)).all();
  const existing = rows[0]?.value;
  if (existing) {
    accessSecretCache = existing;
    return existing;
  }
  const secret = randomBytes(32).toString('base64url');
  db.insert(shareMeta)
    .values({ key: ACCESS_SECRET_KEY, value: secret })
    .onConflictDoNothing()
    .run();
  // 併走した別プロセスが先に入れていたら、その値を正とする
  const after = db.select().from(shareMeta).where(eq(shareMeta.key, ACCESS_SECRET_KEY)).all();
  accessSecretCache = after[0]?.value ?? secret;
  return accessSecretCache;
}

/** テスト用: 秘密のキャッシュを破棄（resetShareDbForTesting と組で使う） */
export function resetAccessSecretForTesting(): void {
  accessSecretCache = null;
}

export function makeAccessCookie(kind: 'r' | 'b', slug: string): string {
  return createHash('sha256')
    .update(getAccessCookieSecret())
    .update(`${kind}:${slug}`)
    .digest('base64url');
}

export function verifyAccessCookie(
  kind: 'r' | 'b',
  slug: string,
  cookie: string | undefined,
): boolean {
  if (!cookie) return false;
  const expected = makeAccessCookie(kind, slug);
  const a = Buffer.from(expected);
  const b = Buffer.from(cookie);
  return a.length === b.length && timingSafeEqual(a, b);
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
