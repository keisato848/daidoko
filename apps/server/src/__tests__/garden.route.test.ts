/**
 * Integration tests for POST /api/v1/garden/consult（さいえん手帳の AI 相談）
 * vitest + Hono with an injected garden-consult provider (no network).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import {
  GARDEN_SYSTEM_PROMPT_FOR_TESTING,
  type GardenConsultInput,
  type GardenConsultProvider,
} from '../lib/garden-vision.js';
import { setGardenProviderForTesting } from '../routes/garden.js';

const TINY_BASE64 = Buffer.from('fake-jpeg-bytes').toString('base64');

function post(body: unknown, headers: Record<string, string> = {}) {
  return app.request('/api/v1/garden/consult', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => resetRateLimitForTesting());
afterEach(() => setGardenProviderForTesting(null));

describe('POST /api/v1/garden/consult', () => {
  it('returns the diagnosis from the provider', async () => {
    let received: GardenConsultInput | null = null;
    setGardenProviderForTesting({
      consult: async (input) => {
        received = input;
        return {
          isPlant: true,
          plantGuess: 'ミニトマト',
          plantConfidence: 'medium',
          healthStatus: 'concern',
          issues: [{ name: '窒素不足', likelihood: 'medium', signs: '下葉から黄化している' }],
          advice: ['追肥を検討してください'],
          checkPoints: ['黄化が下葉だけか、株全体かを確認'],
        };
      },
    } as GardenConsultProvider);

    const res = await post({
      imageBase64: TINY_BASE64,
      mimeType: 'image/jpeg',
      cropName: 'ミニトマト',
      question: '下葉が黄色いです',
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { plantGuess: string; issues: { name: string }[] };
    };
    expect(json.ok).toBe(true);
    expect(json.data.plantGuess).toBe('ミニトマト');
    expect(json.data.issues[0]?.name).toBe('窒素不足');
    // 作物名と相談文がそのままプロバイダへ渡ること（プロンプトの材料になる）
    expect(received).toMatchObject({ cropName: 'ミニトマト', question: '下葉が黄色いです' });
  });

  it('works without cropName / question (photo-only diagnosis)', async () => {
    setGardenProviderForTesting({
      consult: async () => ({ isPlant: true, plantGuess: 'キュウリ', healthStatus: 'healthy' }),
    } as GardenConsultProvider);

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    const json = (await res.json()) as { ok: boolean; data: { isPlant: boolean } };
    expect(json.ok).toBe(true);
    expect(json.data.isPlant).toBe(true);
  });

  it('rejects a missing image (validation)', async () => {
    const res = await post({ imageBase64: '', mimeType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long question (validation)', async () => {
    const res = await post({
      imageBase64: TINY_BASE64,
      mimeType: 'image/jpeg',
      question: 'あ'.repeat(1001),
    });
    expect(res.status).toBe(400);
  });

  it('returns ok:false when the provider throws', async () => {
    setGardenProviderForTesting({
      consult: async () => {
        throw new Error('boom');
      },
    } as GardenConsultProvider);
    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('AI_INFER_FAILED');
  });

  it('rate limits per client with a garden-scoped counter', async () => {
    setGardenProviderForTesting({
      consult: async () => ({ isPlant: true }),
    } as GardenConsultProvider);

    // INFER_DAILY_LIMIT の既定 20 を garden スコープでも共有する。
    // 21 回目で client 上限に当たること（グローバル既定 30 の手前）を見る。
    let limited = false;
    for (let i = 0; i < 21; i++) {
      const res = await post(
        { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' },
        { 'x-forwarded-for': '203.0.113.7' },
      );
      const json = (await res.json()) as { ok: boolean; error?: { code: string } };
      if (!json.ok && json.error?.code === 'RATE_LIMITED') {
        limited = true;
        expect(i).toBe(20);
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it('keeps the pesticide guard in the system prompt (§8.4)', () => {
    // ガード文言を消す変更に対する回帰テスト。文言の微修正は許容するが、
    // 「使用推奨をしない」「ラベルと法令に従う」の 2 点は残っていること。
    expect(GARDEN_SYSTEM_PROMPT_FOR_TESTING).toContain('希釈倍率');
    expect(GARDEN_SYSTEM_PROMPT_FOR_TESTING).toContain('製品ラベル');
    expect(GARDEN_SYSTEM_PROMPT_FOR_TESTING).toContain('可食判断');
  });
});
