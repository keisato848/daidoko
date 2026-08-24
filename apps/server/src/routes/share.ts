/**
 * Web 共有 — レシピ共有リンク（docs/Web共有設計.md）。
 *
 * shareApiRouter  → /api/v1/share  （公開・取り消し・バックアップダンプ）
 * sharePageRouter → /r             （閲覧ページ・写真）
 *
 * 権利面の入口ゲート（URL 取り込みは共有不可）はクライアント側で機械判定するが、
 * サーバーは `attested: true`（自分で作成した内容だとの確認）を必須にして証跡を残す。
 * レート制限は AI 系（rate-limit.ts）と別枠 — こちらは Gemini コストではなく
 * ストレージ濫用のガード。
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  renderBookPage,
  renderNotFoundPage,
  renderPasscodePage,
  renderSharePage,
  storeUrlForUserAgent,
} from '../lib/share-page.js';
import {
  createBookShare,
  createShare,
  exportAllBooks,
  exportAllShares,
  getActiveBook,
  getActiveShare,
  makeBookCookie,
  revokeBookShare,
  revokeShare,
  updateBookShare,
  verifyBookCookie,
  verifyBookPasscode,
} from '../lib/share-store.js';

// ── ベース URL（共有 URL の組み立てと OGP の絶対 URL に使う） ────────────────
function shareBaseUrl(): string {
  const fromEnv = process.env['SHARE_BASE_URL'];
  if (fromEnv && fromEnv.trim() !== '') return fromEnv.replace(/\/$/, '');
  return 'https://daidoko-production.up.railway.app';
}

// ── レート制限（share 専用・in-memory・24h 窓） ──────────────────────────────
const WINDOW_MS = 24 * 60 * 60 * 1000;
const shareBuckets = new Map<string, { count: number; resetAt: number }>();

function shareLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function checkShareRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const take = (key: string, limit: number): boolean => {
    if (limit <= 0) return true; // 0 = 無効
    const existing = shareBuckets.get(key);
    const bucket =
      !existing || now >= existing.resetAt ? { count: 0, resetAt: now + WINDOW_MS } : existing;
    shareBuckets.set(key, bucket);
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  };
  // グローバル → クライアントの順（グローバル超過時にクライアント枠を消費しない）
  if (!take('__global__', shareLimit('SHARE_GLOBAL_DAILY_LIMIT', 500))) return false;
  return take(clientKey, shareLimit('SHARE_DAILY_LIMIT', 20));
}

export function resetShareRateLimitForTesting(): void {
  shareBuckets.clear();
}

// ── スキーマ ─────────────────────────────────────────────────────────────────
// 写真は長辺 1200px / JPEG q0.7 圧縮後の base64（〜300KB 想定）。余裕を見て 2MB 弾
const MAX_PHOTO_BASE64_LENGTH = 2_800_000; // ~2MB decoded

const shareRecipeBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  servings: z.number().int().min(1).max(100).optional(),
  cookTimeMin: z.number().int().min(1).max(6000).optional(),
  description: z.string().max(2000).optional(),
  ingredients: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        amount: z.string().max(60).optional(),
        note: z.string().max(120).optional(),
        groupLabel: z.string().max(60).optional(),
      }),
    )
    .max(100),
  steps: z.array(z.object({ body: z.string().trim().min(1).max(2000) })).max(50),
  tags: z.array(z.string().trim().min(1).max(30)).max(10),
  photoBase64: z.string().min(1).max(MAX_PHOTO_BASE64_LENGTH).optional(),
  photoMime: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
});

const shareRecipeSchema = shareRecipeBodySchema.extend({
  /** クライアントの確認ダイアログ（自分で作成した内容）を通った証跡 */
  attested: z.literal(true),
  locale: z.enum(['ja', 'en']),
});

// レシピ帖（S2）: 複数レシピを 1 ページに。写真込みで重くなるため冊数を絞る
// S4-2: 公開の強度（有効期限・パスコード）。null/省略 = 無し
const shareBookSchema = z.object({
  attested: z.literal(true),
  locale: z.enum(['ja', 'en']),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  recipes: z.array(shareRecipeBodySchema).min(1).max(20),
  expiresInDays: z
    .union([z.literal(7), z.literal(30)])
    .nullable()
    .optional(),
  passcode: z
    .string()
    .regex(/^\d{4}$/)
    .nullable()
    .optional(),
});

function accessFromBody(body: {
  expiresInDays?: 7 | 30 | null | undefined;
  passcode?: string | null | undefined;
}): { expiresAt: string | null; passcode: string | null } {
  const expiresAt = body.expiresInDays
    ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;
  return { expiresAt, passcode: body.passcode ?? null };
}

function clientIp(headers: { get: (name: string) => string | null | undefined }): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'anonymous'
  );
}

// ── API ──────────────────────────────────────────────────────────────────────
const shareApiRouter = new Hono();

shareApiRouter.post('/recipes', zValidator('json', shareRecipeSchema), (c) => {
  const ip = clientIp({ get: (n) => c.req.header(n) });
  if (!checkShareRateLimit(`share:${ip}`)) {
    return c.json(
      {
        ok: false,
        error: { code: 'RATE_LIMITED', message: '本日の共有上限に達しました', retryable: false },
      },
      429,
    );
  }

  const body = c.req.valid('json');
  let photo: { data: Buffer; mime: string } | undefined;
  if (body.photoBase64 && body.photoMime) {
    const data = Buffer.from(body.photoBase64, 'base64');
    if (data.length === 0) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PHOTO', message: '写真を読めませんでした' } },
        400,
      );
    }
    photo = { data, mime: body.photoMime };
  }

  const { slug, deleteToken } = createShare({
    locale: body.locale,
    title: body.title,
    servings: body.servings,
    cookTimeMin: body.cookTimeMin,
    description: body.description,
    ingredients: body.ingredients,
    steps: body.steps,
    tags: body.tags,
    photo,
  });

  return c.json({ ok: true, slug, url: `${shareBaseUrl()}/r/${slug}`, deleteToken });
});

shareApiRouter.delete('/recipes/:slug', (c) => {
  const token = c.req.header('x-share-delete-token') ?? '';
  if (token === '') {
    return c.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'トークンがありません' } },
      403,
    );
  }
  const result = revokeShare(c.req.param('slug'), token);
  if (result === 'not-found') {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '見つかりません' } }, 404);
  }
  if (result === 'forbidden') {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'トークンが違います' } }, 403);
  }
  return c.json({ ok: true });
});

// ── レシピ帖 ─────────────────────────────────────────────────────────────────

function decodePhoto(
  photoBase64: string | undefined,
  photoMime: string | undefined,
): { data: Buffer; mime: string } | undefined {
  if (!photoBase64 || !photoMime) return undefined;
  const data = Buffer.from(photoBase64, 'base64');
  return data.length > 0 ? { data, mime: photoMime } : undefined;
}

shareApiRouter.post('/books', zValidator('json', shareBookSchema), (c) => {
  const ip = clientIp({ get: (n) => c.req.header(n) });
  if (!checkShareRateLimit(`share:${ip}`)) {
    return c.json(
      {
        ok: false,
        error: { code: 'RATE_LIMITED', message: '本日の共有上限に達しました', retryable: false },
      },
      429,
    );
  }

  const body = c.req.valid('json');
  const access = accessFromBody(body);
  const { slug, deleteToken } = createBookShare(bookInputFromBody(body), access);

  return c.json({
    ok: true,
    slug,
    url: `${shareBaseUrl()}/b/${slug}`,
    deleteToken,
    expiresAt: access.expiresAt,
  });
});

function bookInputFromBody(body: {
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
    photoBase64?: string | undefined;
    photoMime?: string | undefined;
  }[];
}): Parameters<typeof createBookShare>[0] {
  return {
    locale: body.locale,
    title: body.title,
    description: body.description,
    recipes: body.recipes.map((recipe) => ({
      title: recipe.title,
      servings: recipe.servings,
      cookTimeMin: recipe.cookTimeMin,
      description: recipe.description,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      tags: recipe.tags,
      photo: decodePhoto(recipe.photoBase64, recipe.photoMime),
    })),
  };
}

// S4: 中身の差し替え。slug は不変（配ったリンクを生かす）。認証 = 削除トークン
shareApiRouter.patch('/books/:slug', zValidator('json', shareBookSchema), (c) => {
  const token = c.req.header('x-share-delete-token') ?? '';
  if (token === '') {
    return c.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'トークンがありません' } },
      403,
    );
  }
  const ip = clientIp({ get: (n) => c.req.header(n) });
  if (!checkShareRateLimit(`share:${ip}`)) {
    return c.json(
      {
        ok: false,
        error: { code: 'RATE_LIMITED', message: '本日の共有上限に達しました', retryable: false },
      },
      429,
    );
  }
  const body = c.req.valid('json');
  const access = accessFromBody(body);
  const slug = c.req.param('slug');
  const result = updateBookShare(slug, token, bookInputFromBody(body), access);
  if (result === 'not-found') {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '見つかりません' } }, 404);
  }
  if (result === 'forbidden') {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'トークンが違います' } }, 403);
  }
  return c.json({
    ok: true,
    slug,
    url: `${shareBaseUrl()}/b/${slug}`,
    expiresAt: access.expiresAt,
  });
});

shareApiRouter.delete('/books/:slug', (c) => {
  const token = c.req.header('x-share-delete-token') ?? '';
  if (token === '') {
    return c.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'トークンがありません' } },
      403,
    );
  }
  const result = revokeBookShare(c.req.param('slug'), token);
  if (result === 'not-found') {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '見つかりません' } }, 404);
  }
  if (result === 'forbidden') {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'トークンが違います' } }, 403);
  }
  return c.json({ ok: true });
});

// バックアップ用の全件ダンプ。SHARE_EXPORT_TOKEN 未設定なら存在ごと隠す（404）
/**
 * 共有レシピの JSON（#198: 共有リンクをアプリで開く）。
 *
 * 閲覧ページ（/r/:slug）と同じ公開範囲 — リンクを知っている人なら誰でも読める。
 * 写真は返さない（別経路 /r/:slug/photo）。アプリは取り込み画面で中身を見せて、
 * 確認してから保存する（いきなり保存しない — URL 取り込みと同じ）。
 */
shareApiRouter.get('/recipes/:slug', (c) => {
  const row = getActiveShare(c.req.param('slug'));
  if (!row) return c.json({ ok: false, error: 'NOT_FOUND' }, 404);
  return c.json({ ok: true, data: shareRowToJson(row) });
});

/**
 * 共有レシピ帖の JSON。パスコード付きの帖は `x-share-passcode` ヘッダで渡す
 * （閲覧ページの cookie と同じ検証・同じロック）。
 */
shareApiRouter.get('/books/:slug', (c) => {
  const slug = c.req.param('slug');
  const found = getActiveBook(slug);
  if (!found) return c.json({ ok: false, error: 'NOT_FOUND' }, 404);
  if (found.book.passcodeHash) {
    const passcode = c.req.header('x-share-passcode') ?? '';
    if (!/^\d{4}$/.test(passcode)) return c.json({ ok: false, error: 'PASSCODE_REQUIRED' }, 401);
    const check = verifyBookPasscode(slug, passcode);
    if (check === 'locked') return c.json({ ok: false, error: 'PASSCODE_LOCKED' }, 429);
    if (check === 'wrong') return c.json({ ok: false, error: 'PASSCODE_WRONG' }, 401);
  }
  return c.json({
    ok: true,
    data: {
      slug: found.book.slug,
      title: found.book.title,
      description: found.book.description,
      locale: found.book.locale,
      recipes: found.recipes.map((r) => ({
        title: r.title,
        servings: r.servings,
        cookTimeMin: r.cookTimeMin,
        description: r.description,
        ingredients: JSON.parse(r.ingredientsJson) as unknown,
        steps: JSON.parse(r.stepsJson) as unknown,
        tags: JSON.parse(r.tagsJson) as unknown,
      })),
    },
  });
});

function shareRowToJson(row: ReturnType<typeof getActiveShare>): Record<string, unknown> {
  if (!row) return {};
  return {
    slug: row.slug,
    title: row.title,
    servings: row.servings,
    cookTimeMin: row.cookTimeMin,
    description: row.description,
    locale: row.locale,
    ingredients: JSON.parse(row.ingredientsJson) as unknown,
    steps: JSON.parse(row.stepsJson) as unknown,
    tags: JSON.parse(row.tagsJson) as unknown,
    hasPhoto: row.photo !== null,
  };
}

shareApiRouter.get('/export', (c) => {
  const expected = process.env['SHARE_EXPORT_TOKEN'];
  if (!expected || expected.trim() === '') return c.notFound();
  if (c.req.header('x-export-token') !== expected) return c.notFound();
  return c.json({ ok: true, shares: exportAllShares(), books: exportAllBooks() });
});

// ── 閲覧ページ ───────────────────────────────────────────────────────────────
const sharePageRouter = new Hono();

sharePageRouter.get('/:slug', (c) => {
  const row = getActiveShare(c.req.param('slug'));
  c.header('X-Robots-Tag', 'noindex');
  if (!row) {
    return c.html(renderNotFoundPage(), 404);
  }
  return c.html(
    renderSharePage(row, shareBaseUrl(), storeUrlForUserAgent(c.req.header('user-agent'))),
  );
});

sharePageRouter.get('/:slug/photo', (c) => {
  const row = getActiveShare(c.req.param('slug'));
  c.header('X-Robots-Tag', 'noindex');
  if (!row || !row.photo || !row.photoMime) return c.notFound();
  c.header('Content-Type', row.photoMime);
  c.header('Cache-Control', 'public, max-age=86400');
  return c.body(new Uint8Array(row.photo));
});

// ── レシピ帖 閲覧ページ ──────────────────────────────────────────────────────
const bookPageRouter = new Hono();

const BOOK_COOKIE = 'daidoko_book';

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

/** パスコード保護中で未認証なら true（ページ・写真とも同じ判定で守る） */
function bookLocked(
  c: { req: { header: (n: string) => string | undefined } },
  slug: string,
  passcodeHash: string | null,
): boolean {
  if (!passcodeHash) return false;
  const cookie = parseCookie(c.req.header('cookie'), `${BOOK_COOKIE}_${slug}`);
  return !verifyBookCookie(slug, cookie);
}

bookPageRouter.get('/:slug', (c) => {
  const slug = c.req.param('slug');
  const found = getActiveBook(slug);
  c.header('X-Robots-Tag', 'noindex');
  if (!found) {
    return c.html(renderNotFoundPage(), 404);
  }
  if (bookLocked(c, slug, found.book.passcodeHash)) {
    // 中身もタイトルも出さない（OGP も出さない — プレビューで漏れるため）
    return c.html(renderPasscodePage(slug, found.book.locale, false), 401);
  }
  return c.html(
    renderBookPage(
      found.book,
      found.recipes,
      shareBaseUrl(),
      storeUrlForUserAgent(c.req.header('user-agent')),
    ),
  );
});

// パスコード入力。成功で slug スコープの署名 Cookie を置き、読み直しを許す
bookPageRouter.post('/:slug/unlock', async (c) => {
  const slug = c.req.param('slug');
  const found = getActiveBook(slug);
  c.header('X-Robots-Tag', 'noindex');
  if (!found?.book.passcodeHash) return c.html(renderNotFoundPage(), 404);
  const form = await c.req.parseBody();
  const passcode = typeof form['passcode'] === 'string' ? form['passcode'] : '';
  const check = verifyBookPasscode(slug, passcode);
  if (check !== 'ok') {
    return c.html(renderPasscodePage(slug, found.book.locale, true, check === 'locked'), 401);
  }
  c.header(
    'Set-Cookie',
    `${BOOK_COOKIE}_${slug}=${makeBookCookie(slug)}; Path=/b/${slug}; Max-Age=86400; HttpOnly; SameSite=Lax; Secure`,
  );
  return c.redirect(`/b/${slug}`, 303);
});

bookPageRouter.get('/:slug/photo/:index', (c) => {
  const slug = c.req.param('slug');
  const found = getActiveBook(slug);
  c.header('X-Robots-Tag', 'noindex');
  // ページだけ守って写真が直リンクで読めては意味がない — 同じ鍵で守る
  if (found && bookLocked(c, slug, found.book.passcodeHash)) return c.notFound();
  const index = Number(c.req.param('index'));
  const recipe = found && Number.isInteger(index) ? found.recipes[index] : undefined;
  if (!recipe?.photo || !recipe.photoMime) return c.notFound();
  c.header('Content-Type', recipe.photoMime);
  c.header(
    'Cache-Control',
    found?.book.passcodeHash ? 'private, max-age=3600' : 'public, max-age=86400',
  );
  return c.body(new Uint8Array(recipe.photo));
});

export { bookPageRouter, shareApiRouter, sharePageRouter };
