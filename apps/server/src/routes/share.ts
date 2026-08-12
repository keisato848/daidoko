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

import { renderNotFoundPage, renderSharePage } from '../lib/share-page.js';
import { createShare, exportAllShares, getActiveShare, revokeShare } from '../lib/share-store.js';

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

const shareRecipeSchema = z.object({
  /** クライアントの確認ダイアログ（自分で作成した内容）を通った証跡 */
  attested: z.literal(true),
  locale: z.enum(['ja', 'en']),
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

// バックアップ用の全件ダンプ。SHARE_EXPORT_TOKEN 未設定なら存在ごと隠す（404）
shareApiRouter.get('/export', (c) => {
  const expected = process.env['SHARE_EXPORT_TOKEN'];
  if (!expected || expected.trim() === '') return c.notFound();
  if (c.req.header('x-export-token') !== expected) return c.notFound();
  return c.json({ ok: true, shares: exportAllShares() });
});

// ── 閲覧ページ ───────────────────────────────────────────────────────────────
const sharePageRouter = new Hono();

sharePageRouter.get('/:slug', (c) => {
  const row = getActiveShare(c.req.param('slug'));
  c.header('X-Robots-Tag', 'noindex');
  if (!row) {
    return c.html(renderNotFoundPage(), 404);
  }
  return c.html(renderSharePage(row, shareBaseUrl()));
});

sharePageRouter.get('/:slug/photo', (c) => {
  const row = getActiveShare(c.req.param('slug'));
  c.header('X-Robots-Tag', 'noindex');
  if (!row || !row.photo || !row.photoMime) return c.notFound();
  c.header('Content-Type', row.photoMime);
  c.header('Cache-Control', 'public, max-age=86400');
  return c.body(new Uint8Array(row.photo));
});

export { shareApiRouter, sharePageRouter };
