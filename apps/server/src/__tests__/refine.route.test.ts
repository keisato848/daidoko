/**
 * Integration tests for POST /api/v1/infer/refine（感想でレシピを店の味に近づける）
 * vitest + Hono test utilities with an injected provider (no network).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import app from '../index.js';
import { setRefineProviderForTesting } from '../routes/infer.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import {
  RefineQuotaError,
  RefineRequestError,
  buildImageLegend,
  buildRecipeText,
  type RecipeRefineProvider,
  type RefineRecipeInput,
  type RefineRecipeRaw,
} from '../lib/recipe-refine.js';
import { normalizeRefined } from '../agents/recipe-refine.agent.js';

const CURRENT_RECIPE = {
  title: '麻婆豆腐',
  servings: 2,
  cookTimeMin: 25,
  ingredients: [
    { groupLabel: '主材料', name: '木綿豆腐', amount: '1丁' },
    { groupLabel: '主材料', name: '豚ひき肉', amount: '150g' },
    { groupLabel: '調味料', name: '甜麺醤', amount: '大さじ2' },
  ],
  steps: [{ body: '豆腐を切る' }, { body: '肉を炒める' }, { body: '煮る' }],
  tags: ['中華'],
};

/** 甜麺醤だけを減らした応答。無関係な材料・手順は原文のまま */
const ADJUSTED: RefineRecipeRaw = {
  changed: true,
  changeSummary: '甘みを抑えるため、甜麺醤を大さじ2から大さじ1に減らしました。',
  ingredients: [
    { groupLabel: '主材料', name: '木綿豆腐', amount: '1丁' },
    { groupLabel: '主材料', name: '豚ひき肉', amount: '150g' },
    { groupLabel: '調味料', name: '甜麺醤', amount: '大さじ1' },
  ],
  steps: [{ body: '豆腐を切る' }, { body: '肉を炒める' }, { body: '煮る' }],
};

const TINY_BASE64 = Buffer.from('fake-jpeg-bytes').toString('base64');

function stubProvider(impl: RecipeRefineProvider['refine']): void {
  setRefineProviderForTesting({ refine: impl });
}

function post(body: unknown) {
  return app.request('/api/v1/infer/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  setRefineProviderForTesting(null);
  resetRateLimitForTesting();
});

describe('POST /api/v1/infer/refine', () => {
  describe('バリデーション', () => {
    it('感想が空なら 400', async () => {
      const res = await post({ recipe: CURRENT_RECIPE, feedback: '' });
      expect(res.status).toBe(400);
    });

    it('材料が空のレシピは 400', async () => {
      const res = await post({
        recipe: { ...CURRENT_RECIPE, ingredients: [] },
        feedback: '甘すぎた',
      });
      expect(res.status).toBe(400);
    });

    it('写真は3枚以上受け付けない（cooked / target の2枚まで）', async () => {
      const image = { imageBase64: TINY_BASE64, mimeType: 'image/jpeg', role: 'cooked' };
      const res = await post({
        recipe: CURRENT_RECIPE,
        feedback: '甘すぎた',
        images: [image, image, image],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('成功ケース', () => {
    it('感想 → 調整後レシピと changeSummary を返す', async () => {
      stubProvider(async () => ADJUSTED);
      const res = await post({ recipe: CURRENT_RECIPE, feedback: '店のよりかなり甘かった' });
      const body = (await res.json()) as {
        ok: boolean;
        data?: {
          draft: { ingredients: { name: string; amount?: string }[] };
          changeSummary: string;
        };
      };

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.changeSummary).toContain('甜麺醤');
      expect(body.data?.draft.ingredients).toContainEqual(
        expect.objectContaining({ name: '甜麺醤', amount: '大さじ1' }),
      );
    });

    it('感想と無関係な材料は書き換わらない', async () => {
      stubProvider(async () => ADJUSTED);
      const res = await post({ recipe: CURRENT_RECIPE, feedback: '甘すぎた' });
      const body = (await res.json()) as {
        data?: { draft: { ingredients: { name: string; amount?: string }[] } };
      };

      // 完了条件（Issue #113）: 指示していない材料が変わっていないこと
      expect(body.data?.draft.ingredients).toContainEqual(
        expect.objectContaining({ name: '木綿豆腐', amount: '1丁' }),
      );
      expect(body.data?.draft.ingredients).toContainEqual(
        expect.objectContaining({ name: '豚ひき肉', amount: '150g' }),
      );
    });

    it('モデルが省いたフィールドは現行レシピの値を残す', async () => {
      // servings / cookTimeMin / title / tags を返さない応答
      stubProvider(async () => ADJUSTED);
      const res = await post({ recipe: CURRENT_RECIPE, feedback: '甘すぎた' });
      const body = (await res.json()) as {
        data?: {
          draft: { title: string; servings?: number; cookTimeMin?: number; tags?: string[] };
        };
      };

      expect(body.data?.draft.title).toBe('麻婆豆腐');
      expect(body.data?.draft.servings).toBe(2);
      expect(body.data?.draft.cookTimeMin).toBe(25);
      expect(body.data?.draft.tags).toEqual(['中華']);
    });

    it('写真は role つきでプロバイダへ渡る', async () => {
      const refine = vi.fn(async (_input: RefineRecipeInput) => ADJUSTED);
      stubProvider(refine);
      await post({
        recipe: CURRENT_RECIPE,
        feedback: '色が薄い',
        images: [
          { imageBase64: TINY_BASE64, mimeType: 'image/jpeg', role: 'cooked' },
          { imageBase64: TINY_BASE64, mimeType: 'image/jpeg', role: 'target' },
        ],
      });

      const passed = refine.mock.calls[0]?.[0];
      expect(passed?.images?.map((image) => image.role)).toEqual(['cooked', 'target']);
    });
  });

  describe('変更点を読み取れなかったとき', () => {
    it('推測で書き換えず、何を書けばよいかを返す', async () => {
      stubProvider(async () => ({
        changed: false,
        changeSummary: '味の方向（甘い・辛い・濃いなど）が書かれていません。',
      }));
      const res = await post({ recipe: CURRENT_RECIPE, feedback: 'おいしかった' });
      const body = (await res.json()) as {
        ok: boolean;
        data?: unknown;
        error?: { code: string; message: string; retryable: boolean };
      };

      expect(body.ok).toBe(false);
      expect(body.data).toBeUndefined();
      expect(body.error?.code).toBe('REFINE_NO_CHANGE');
      // 「もう一度お試しください」だけで終わらせず、次に何を書けばよいかを伝える
      expect(body.error?.message).toContain('味の方向');
      expect(body.error?.retryable).toBe(false);
    });
  });

  describe('失敗ケース', () => {
    it('上流の枠切れは AI_QUOTA_EXCEEDED（「つながらない」と区別する）', async () => {
      stubProvider(async () => {
        throw new RefineQuotaError('Gemini responded 429: RESOURCE_EXHAUSTED');
      });
      const res = await post({ recipe: CURRENT_RECIPE, feedback: '甘すぎた' });
      const body = (await res.json()) as { error?: { code: string; message: string } };

      expect(body.error?.code).toBe('AI_QUOTA_EXCEEDED');
      expect(body.error?.message).toContain('利用上限');
      // 上流の生メッセージ（英語・内部情報）を漏らさない
      expect(body.error?.message).not.toContain('RESOURCE_EXHAUSTED');
      expect(body.error?.message).not.toContain('Gemini');
    });

    it('一時的な失敗は retryable', async () => {
      stubProvider(async () => {
        throw new RefineRequestError('Gemini responded 503');
      });
      const res = await post({ recipe: CURRENT_RECIPE, feedback: '甘すぎた' });
      const body = (await res.json()) as { error?: { code: string; retryable: boolean } };

      expect(body.error?.code).toBe('AI_API_UNAVAILABLE');
      expect(body.error?.retryable).toBe(true);
    });

    it('材料・手順が返ってこなければ調整結果として扱わない', async () => {
      stubProvider(async () => ({ changed: true, changeSummary: '減らしました' }));
      const res = await post({ recipe: CURRENT_RECIPE, feedback: '甘すぎた' });
      const body = (await res.json()) as { ok: boolean; error?: { code: string } };

      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('PHOTO_RECIPE_FAILED');
    });
  });
});

describe('normalizeRefined — モデルの取りこぼしをコードで埋める', () => {
  // 実測: プロンプトで戒めても、感想と無関係な材料の amount / groupLabel を
  // 落とした応答が返ることがあった。分量が消えるのは黙った書き換えと同じなので、
  // 名前で突き合わせて現行レシピの値を残す
  it('材料の amount / groupLabel が抜けていたら現行レシピの値を残す', () => {
    const result = normalizeRefined(
      {
        changed: true,
        ingredients: [{ name: '木綿豆腐' }, { name: '甜麺醤', amount: '大さじ1' }],
        steps: [{ body: '煮る' }],
      },
      CURRENT_RECIPE,
    );

    expect(result?.ingredients).toContainEqual(
      expect.objectContaining({ name: '木綿豆腐', amount: '1丁', groupLabel: '主材料' }),
    );
    // 指示された変更は通す
    expect(result?.ingredients).toContainEqual(
      expect.objectContaining({ name: '甜麺醤', amount: '大さじ1' }),
    );
  });

  it('文字列の "null" は空として扱う（構造化出力でも返ることがある）', () => {
    const result = normalizeRefined(
      {
        changed: true,
        ingredients: [{ name: '甜麺醤', amount: '大さじ1', note: 'null' }],
        steps: [{ body: '煮る' }],
      },
      CURRENT_RECIPE,
    );

    expect(result?.ingredients[0]?.note).toBeUndefined();
  });

  it('新しく増えた材料は現行レシピに無いのでそのまま通す', () => {
    const result = normalizeRefined(
      {
        changed: true,
        ingredients: [{ name: '花椒粉', amount: '小さじ1/2' }],
        steps: [{ body: '振る' }],
      },
      CURRENT_RECIPE,
    );

    expect(result?.ingredients).toEqual([{ name: '花椒粉', amount: '小さじ1/2' }]);
  });
});

describe('normalizeRefined', () => {
  it('材料が全滅したら null（現行レシピで埋めて「直した」と偽らない）', () => {
    const result = normalizeRefined(
      { changed: true, ingredients: [], steps: [{ body: 'x' }] },
      {
        title: '麻婆豆腐',
        ingredients: [{ name: '豆腐' }],
        steps: [{ body: '切る' }],
      },
    );
    expect(result).toBeNull();
  });

  it('タイトルを返さなければ現行のタイトルを保つ', () => {
    const result = normalizeRefined(
      { changed: true, ingredients: [{ name: '豆腐', amount: '1丁' }], steps: [{ body: '切る' }] },
      { title: '麻婆豆腐', ingredients: [{ name: '豆腐' }], steps: [{ body: '切る' }] },
    );
    expect(result?.title).toBe('麻婆豆腐');
  });
});

describe('プロンプト組み立て', () => {
  it('現行レシピは JSON として渡る', () => {
    const text = buildRecipeText(CURRENT_RECIPE);
    expect(JSON.parse(text)).toMatchObject({ title: '麻婆豆腐', servings: 2 });
  });

  it('写真の役割は「現状」と「目指す状態」として説明される', () => {
    const legend = buildImageLegend([
      { imageBase64: 'a', mimeType: 'image/jpeg', role: 'cooked' },
      { imageBase64: 'b', mimeType: 'image/jpeg', role: 'target' },
    ]);
    expect(legend).toContain('写真1: 家で作った結果（現状）');
    expect(legend).toContain('写真2: お店の料理（目指す状態）');
  });

  it('写真がなければ説明を足さない', () => {
    expect(buildImageLegend([])).toBe('');
  });
});
