/**
 * Integration tests for POST /api/v1/infer/meal
 * vitest + Hono with an injected meal-vision provider (no network).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import type { MealVisionProvider } from '../lib/meal-vision.js';
import { setMealProviderForTesting } from '../routes/infer.js';

const TINY_BASE64 = Buffer.from('fake-jpeg-bytes').toString('base64');

function post(body: unknown) {
  return app.request('/api/v1/infer/meal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => resetRateLimitForTesting());
afterEach(() => setMealProviderForTesting(null));

describe('POST /api/v1/infer/meal', () => {
  it('returns the inferred consumed ingredients', async () => {
    setMealProviderForTesting({
      infer: async () => ({
        isMeal: true,
        dish: 'オムライス',
        ingredients: [{ name: '卵' }, { name: 'ご飯' }, { name: '鶏肉' }],
        confidence: 'medium',
      }),
    } as MealVisionProvider);

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { dish: string; ingredients: { name: string }[] };
    };
    expect(json.ok).toBe(true);
    expect(json.data.dish).toBe('オムライス');
    expect(json.data.ingredients.map((i) => i.name)).toEqual(['卵', 'ご飯', '鶏肉']);
  });

  it('rejects a missing image (validation)', async () => {
    const res = await post({ imageBase64: '', mimeType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  it('returns ok:false when the provider throws', async () => {
    setMealProviderForTesting({
      infer: async () => {
        throw new Error('boom');
      },
    } as MealVisionProvider);
    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('AI_INFER_FAILED');
  });
});
