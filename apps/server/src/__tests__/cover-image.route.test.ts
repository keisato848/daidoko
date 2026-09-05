/**
 * POST /api/v1/infer/cover-image（レシピ表紙の AI 生成 / 「イメージ」）。
 * docs/レシピ表紙AI生成設計.md。
 *
 * ここで守りたいのは 4 つ。
 * 1. zod の境界（title/ingredientNames/tags の上限）。
 * 2. `x-device-id` の書式チェック（/infer/menu と同じ様式）。
 * 3. COVER_POOL が RECIPE_POOL と独立している
 *    （片方を使い切ってももう片方は生きる — rate-limit-pools.test.ts と同じ観点）。
 * 4. provider 失敗 → ok:false COVER_IMAGE_FAILED、成功 → mimeType/dataBase64 が返る。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { setCoverImageProviderForTesting } from '../routes/infer.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import {
  CoverImageQuotaError,
  CoverImageRequestError,
  buildCoverImagePrompt,
  type CoverImageInput,
  type CoverImageProvider,
  type CoverImageResult,
} from '../lib/cover-image.js';

function stub(
  reply: (input: CoverImageInput) => CoverImageResult | Promise<CoverImageResult>,
): CoverImageProvider {
  return { generate: async (input) => reply(input) };
}

const DEVICE_ID = 'device-abcdefgh01';

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request('/api/v1/infer/cover-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID, ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  title: '麻婆豆腐',
  ingredientNames: ['木綿豆腐', '豚ひき肉', '甜麺醤'],
  tags: ['中華'],
};

const STUB_RESULT: CoverImageResult = { mimeType: 'image/jpeg', dataBase64: 'ZmFrZQ==' };

type CoverImageResponse =
  | { ok: true; data: { mimeType: string; dataBase64: string } }
  | { ok: false; error: { code: string; retryable: boolean } };

const ENV_KEYS = ['COVER_IMAGE_GLOBAL_DAILY_LIMIT', 'COVER_IMAGE_DAILY_LIMIT'];

beforeEach(() => {
  setCoverImageProviderForTesting(null);
  resetRateLimitForTesting();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('POST /api/v1/infer/cover-image — 成功', () => {
  it('provider が成功したら mimeType と dataBase64 を返す', async () => {
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = await post(VALID_BODY);
    const json = (await res.json()) as CoverImageResponse;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.mimeType).toBe('image/jpeg');
      expect(json.data.dataBase64).toBe('ZmFrZQ==');
    }
  });
});

describe('POST /api/v1/infer/cover-image — エラー写像', () => {
  it('provider 失敗 → ok:false COVER_IMAGE_FAILED（retryable:true）', async () => {
    setCoverImageProviderForTesting({
      generate: async () => {
        throw new CoverImageRequestError('boom');
      },
    });
    const res = await post(VALID_BODY);
    const json = (await res.json()) as CoverImageResponse;

    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('COVER_IMAGE_FAILED');
      expect(json.error.retryable).toBe(true);
    }
  });

  it('上流の利用枠切れは AI_QUOTA_EXCEEDED（retryable:false）', async () => {
    setCoverImageProviderForTesting({
      generate: async () => {
        throw new CoverImageQuotaError('quota');
      },
    });
    const res = await post(VALID_BODY);
    const json = (await res.json()) as CoverImageResponse;

    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('AI_QUOTA_EXCEEDED');
      expect(json.error.retryable).toBe(false);
    }
  });
});

describe('POST /api/v1/infer/cover-image — x-device-id', () => {
  it('x-device-id が無いと受け付けない', async () => {
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = await app.request('/api/v1/infer/cover-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // x-device-id 無し
      body: JSON.stringify(VALID_BODY),
    });
    const json = (await res.json()) as CoverImageResponse;
    expect(json.ok).toBe(false);
  });

  it('x-device-id が書式違反（短すぎ）なら受け付けない', async () => {
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = await post(VALID_BODY, { 'x-device-id': 'short' });
    const json = (await res.json()) as CoverImageResponse;
    expect(json.ok).toBe(false);
  });
});

describe('POST /api/v1/infer/cover-image — zod の境界', () => {
  it('title が空なら 400', async () => {
    const res = await post({ ...VALID_BODY, title: '' });
    expect(res.status).toBe(400);
  });

  it('title が 100 字超なら 400', async () => {
    const res = await post({ ...VALID_BODY, title: 'あ'.repeat(101) });
    expect(res.status).toBe(400);
  });

  it('ingredientNames が 20 件超なら 400', async () => {
    const res = await post({
      ...VALID_BODY,
      ingredientNames: Array.from({ length: 21 }, (_, i) => `材料${i}`),
    });
    expect(res.status).toBe(400);
  });

  it('ingredientNames の 1 件が 50 字超なら 400', async () => {
    const res = await post({ ...VALID_BODY, ingredientNames: ['あ'.repeat(51)] });
    expect(res.status).toBe(400);
  });

  it('tags が 5 件超なら 400', async () => {
    const res = await post({
      ...VALID_BODY,
      tags: Array.from({ length: 6 }, (_, i) => `タグ${i}`),
    });
    expect(res.status).toBe(400);
  });

  it('ingredientNames/tags は 0 件でも通る（任意）', async () => {
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = await post({ title: '麻婆豆腐', ingredientNames: [], tags: [] });
    const json = (await res.json()) as CoverImageResponse;
    expect(json.ok).toBe(true);
  });

  it('locale は ja/en 以外なら 400', async () => {
    const res = await post({ ...VALID_BODY, locale: 'fr' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/infer/cover-image — COVER_POOL は独立している', () => {
  it('COVER_IMAGE_GLOBAL_DAILY_LIMIT を使い切っても /infer/menu 等（RECIPE_POOL）は無傷', async () => {
    process.env['COVER_IMAGE_GLOBAL_DAILY_LIMIT'] = '1';
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));

    const first = (await (await post(VALID_BODY)).json()) as CoverImageResponse;
    expect(first.ok).toBe(true);

    const second = (await (await post(VALID_BODY)).json()) as CoverImageResponse;
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('RATE_LIMITED');

    // RECIPE_POOL（INFER_GLOBAL_DAILY_LIMIT）は別カウンタなので、
    // /infer/menu は cover-image の枠切れに巻き込まれない
    const menuRes = await app.request('/api/v1/infer/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID },
      body: JSON.stringify({
        candidates: [{ id: 'a', title: 'レシピa', coveragePct: 80, missing: [] }],
        pantry: [],
        days: 1,
      }),
    });
    // AI_API_UNAVAILABLE（GEMINI_API_KEY 未設定）にはなり得るが、
    // 少なくとも cover-image の RATE_LIMITED では止まらない
    const menuJson = (await menuRes.json()) as { ok: boolean; error?: { code: string } };
    if (!menuJson.ok) expect(menuJson.error?.code).not.toBe('RATE_LIMITED');
  });

  it('INFER_GLOBAL_DAILY_LIMIT（RECIPE_POOL）を使い切っても cover-image は無傷', async () => {
    // menu 側を 1 発で使い切る
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '1';
    await app.request('/api/v1/infer/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID },
      body: JSON.stringify({
        candidates: [{ id: 'a', title: 'レシピa', coveragePct: 80, missing: [] }],
        pantry: [],
        days: 1,
      }),
    });

    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = (await (await post(VALID_BODY)).json()) as CoverImageResponse;
    expect(res.ok).toBe(true);
  });
});

describe('プロンプトの組み立て', () => {
  it('材料・タグを含める', () => {
    const text = buildCoverImagePrompt({
      title: '麻婆豆腐',
      ingredientNames: ['木綿豆腐', '豚ひき肉'],
      tags: ['中華'],
    });
    expect(text).toContain('麻婆豆腐');
    expect(text).toContain('木綿豆腐');
    expect(text).toContain('豚ひき肉');
    expect(text).toContain('中華');
  });

  it('材料に無い食材を描かない・文字やロゴを入れない、の縛りを含める', () => {
    const text = buildCoverImagePrompt({ title: '麻婆豆腐', ingredientNames: [], tags: [] });
    expect(text).toContain('材料リストに無い食材を描き足さない');
    expect(text).toContain('文字・ロゴ');
  });
});
