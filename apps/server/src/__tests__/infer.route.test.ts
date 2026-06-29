/**
 * Integration tests for POST /api/v1/infer/photo
 * Uses vitest + Hono test utilities with an injected Vision provider (no network).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { setInferProviderForTesting } from '../routes/infer.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import {
  VisionRequestError,
  type VisionRecipeProvider,
  type VisionRecipeRaw,
} from '../lib/vision-recipe.js';

const VALID_DISH: VisionRecipeRaw = {
  isDish: true,
  title: '麻婆豆腐',
  titleReading: 'まーぼーどうふ',
  description: '痺れと辛さの中華',
  servings: 2,
  cookTimeMin: 20,
  ingredients: [
    { name: '木綿豆腐', amount: '1丁' },
    { name: '豚ひき肉', amount: '150g' },
  ],
  steps: [{ body: '豆腐を切る' }, { body: '炒めて煮る' }],
  tags: ['中華'],
  confidence: 'medium',
};

function stubProvider(impl: VisionRecipeProvider['infer']): void {
  setInferProviderForTesting({ infer: impl });
}

const TINY_BASE64 = Buffer.from('fake-jpeg-bytes').toString('base64');

function post(body: unknown) {
  return app.request('/api/v1/infer/photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  setInferProviderForTesting(null);
  resetRateLimitForTesting();
});

describe('POST /api/v1/infer/photo', () => {
  describe('バリデーション', () => {
    it('画像がなければ 400', async () => {
      const res = await post({ mimeType: 'image/jpeg' });
      expect(res.status).toBe(400);
    });

    it('未対応の mimeType は 400', async () => {
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/gif' });
      expect(res.status).toBe(400);
    });
  });

  describe('成功ケース', () => {
    beforeEach(() => {
      stubProvider(async () => VALID_DISH);
    });

    it('料理写真 → ok:true, RecipeDraft を返す', async () => {
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg', context: '辛め' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        data?: { title: string; ingredients: unknown[]; steps: unknown[]; confidence: string };
      };
      expect(body.ok).toBe(true);
      expect(body.data?.title).toBe('麻婆豆腐');
      expect(body.data?.ingredients).toHaveLength(2);
      expect(body.data?.steps).toHaveLength(2);
      expect(body.data?.confidence).toBe('medium');
    });
  });

  describe('エラーケース', () => {
    it('料理でない画像 → ok:false, VISION_NOT_A_DISH', async () => {
      stubProvider(async () => ({ isDish: false, confidence: 'low' }));
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; error?: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('VISION_NOT_A_DISH');
    });

    it('材料/手順が空の推論結果 → ok:false（下書きに変換不可）', async () => {
      stubProvider(async () => ({ isDish: true, title: '謎の料理', confidence: 'low' }));
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
      const body = (await res.json()) as { ok: boolean; error?: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('PHOTO_RECIPE_FAILED');
    });

    it('プロバイダ接続失敗 → ok:false, AI_API_UNAVAILABLE (retryable)', async () => {
      stubProvider(async () => {
        throw new VisionRequestError('boom');
      });
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
      const body = (await res.json()) as {
        ok: boolean;
        error?: { code: string; retryable: boolean };
      };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('AI_API_UNAVAILABLE');
      expect(body.error?.retryable).toBe(true);
    });
  });

  describe('レート制限', () => {
    afterEach(() => {
      delete process.env['INFER_DAILY_LIMIT'];
      delete process.env['INFER_GLOBAL_DAILY_LIMIT'];
    });

    function postFromIp(ip: string) {
      return app.request('/api/v1/infer/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' }),
      });
    }

    it('per-client 上限超過で RATE_LIMITED', async () => {
      process.env['INFER_DAILY_LIMIT'] = '3';
      stubProvider(async () => VALID_DISH);
      let lastBody: { ok: boolean; error?: { code: string } } = { ok: true };
      for (let i = 0; i < 4; i++) {
        const res = await postFromIp('10.0.0.1');
        lastBody = (await res.json()) as { ok: boolean; error?: { code: string } };
      }
      expect(lastBody.ok).toBe(false);
      expect(lastBody.error?.code).toBe('RATE_LIMITED');
    });

    it('global 上限超過で RATE_LIMITED（別クライアントでも）', async () => {
      process.env['INFER_DAILY_LIMIT'] = '0'; // disable per-client
      process.env['INFER_GLOBAL_DAILY_LIMIT'] = '3';
      stubProvider(async () => VALID_DISH);
      // Different IPs each time — only the global cap should block.
      let lastBody: { ok: boolean; error?: { code: string } } = { ok: true };
      for (let i = 0; i < 4; i++) {
        const res = await postFromIp(`10.0.0.${i + 1}`);
        lastBody = (await res.json()) as { ok: boolean; error?: { code: string } };
      }
      expect(lastBody.ok).toBe(false);
      expect(lastBody.error?.code).toBe('RATE_LIMITED');
    });
  });
});
