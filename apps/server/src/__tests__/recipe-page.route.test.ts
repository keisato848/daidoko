/**
 * Integration tests for POST /api/v1/infer/recipe-page
 * （紙面に書かれたレシピの読み取り。端末内 OCR からの置き換え）
 *
 * vitest + Hono with an injected provider (no network).
 *
 * **ここで見張る中心は 2 つ。**
 * 1. 紙面は片面だけを撮ることが普通なので、**材料か手順のどちらかが読めていれば通す**
 *    （料理写真の `/photo` は 3 つ揃わないと通さない。受け入れ条件が違う）
 * 2. 複数枚を**そのままモデルへ渡す**（表と裏で 1 つのレシピになるため）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import type { RecipePageInput, RecipePageProvider } from '../lib/recipe-page.js';
import { setRecipePageProviderForTesting } from '../routes/infer.js';

const TINY_BASE64 = Buffer.from('fake-jpeg-bytes').toString('base64');

function image() {
  return { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' as const };
}

function post(body: unknown) {
  return app.request('/api/v1/infer/recipe-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => resetRateLimitForTesting());
afterEach(() => setRecipePageProviderForTesting(null));

describe('POST /api/v1/infer/recipe-page', () => {
  it('読み取れた紙面を RecipeDraft にして返す', async () => {
    setRecipePageProviderForTesting({
      read: async () => ({
        found: true,
        title: 'アンチョビポテト',
        servings: 2,
        ingredients: [
          { name: 'じゃがいも(くし形切り)', amount: '中2個(300g)' },
          { name: 'サラダ油', amount: '大さじ1' },
        ],
        steps: [{ body: 'じゃがいもを耐熱皿に入れ、ラップをして電子レンジで加熱します。' }],
        confidence: 'high',
      }),
    } as RecipePageProvider);

    const res = await post({ images: [image()] });
    const json = (await res.json()) as { ok: boolean; data?: Record<string, unknown> };

    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({
      title: 'アンチョビポテト',
      servings: 2,
      confidence: 'high',
    });
    expect(json.data?.ingredients).toHaveLength(2);
  });

  it('複数枚をそのままモデルへ渡す（表と裏で 1 つのレシピ）', async () => {
    const calls: RecipePageInput[] = [];
    setRecipePageProviderForTesting({
      read: async (input) => {
        calls.push(input);
        return {
          found: true,
          title: 'アンチョビポテト',
          ingredients: [{ name: 'じゃがいも', amount: '2個' }],
          steps: [{ body: '炒める' }],
          confidence: 'high',
        };
      },
    } as RecipePageProvider);

    const res = await post({ images: [image(), image()], context: 'S&B シーズニング' });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].images).toHaveLength(2);
    expect(calls[0].context).toBe('S&B シーズニング');
  });

  it('料理名が無くても、材料か手順が読めていれば通す（紙面は片面だけを撮る）', async () => {
    setRecipePageProviderForTesting({
      read: async () => ({
        found: true,
        ingredients: [],
        steps: [{ body: '油を熱し、焼き目が付くまで炒めます。' }],
        confidence: 'medium',
      }),
    } as RecipePageProvider);

    const json = (await (await post({ images: [image()] })).json()) as {
      ok: boolean;
      data?: { title: string; steps: unknown[] };
    };

    expect(json.ok).toBe(true);
    expect(json.data?.title).toBe('');
    expect(json.data?.steps).toHaveLength(1);
  });

  it('材料も手順も無ければ通さない（見出しだけの下書きを作らない）', async () => {
    setRecipePageProviderForTesting({
      read: async () => ({
        found: true,
        title: 'アンチョビポテト',
        ingredients: [],
        steps: [],
        confidence: 'low',
      }),
    } as RecipePageProvider);

    const json = (await (await post({ images: [image()] })).json()) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(json.ok).toBe(false);
    expect(json.error?.code).toBe('RECIPE_PAGE_NOT_FOUND');
  });

  it('弾いた理由ごとに、次に何をすればよいかを返す', async () => {
    setRecipePageProviderForTesting({
      read: async () => ({ found: false, rejectReason: 'unreadable' as const }),
    } as RecipePageProvider);

    const json = (await (await post({ images: [image()] })).json()) as {
      ok: boolean;
      error?: { code: string; message: string; retryable: boolean };
    };

    expect(json.ok).toBe(false);
    expect(json.error?.code).toBe('RECIPE_PAGE_NOT_FOUND');
    expect(json.error?.message).toContain('明るい場所');
    expect(json.error?.retryable).toBe(false);
  });

  it('モデルの返しを保存スキーマの上限に刈り込む', async () => {
    const long = 'あ'.repeat(600);
    setRecipePageProviderForTesting({
      read: async () => ({
        found: true,
        title: long,
        servings: 300,
        cookTimeMin: 5000,
        ingredients: [{ name: long, amount: long }],
        steps: [{ body: long }],
        confidence: 'high',
      }),
    } as RecipePageProvider);

    const json = (await (await post({ images: [image()] })).json()) as {
      ok: boolean;
      data?: {
        title: string;
        servings?: number;
        cookTimeMin?: number;
        ingredients: { name: string; amount?: string }[];
        steps: { body: string }[];
      };
    };

    expect(json.data?.title).toHaveLength(100);
    expect(json.data?.ingredients[0].name).toHaveLength(50);
    expect(json.data?.ingredients[0].amount).toHaveLength(30);
    expect(json.data?.steps[0].body).toHaveLength(500);
    // 範囲外は「読めなかった」扱い
    expect(json.data?.servings).toBeUndefined();
    expect(json.data?.cookTimeMin).toBeUndefined();
  });

  it('画像が無い / 多すぎるリクエストは受け付けない', async () => {
    expect((await post({ images: [] })).status).toBe(400);
    expect((await post({ images: [image(), image(), image(), image(), image()] })).status).toBe(
      400,
    );
  });
});
