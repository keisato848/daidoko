/**
 * Integration tests for POST /api/v1/garden/identify
 * （さいえん手帳の「写真から栽培を登録する」— saien-techo#139 / #149）
 *
 * vitest + Hono with an injected identify provider (no network).
 *
 * **ここで見張る中心は sanitize の境界。** 台帳に載るのは作物名と品種で、
 * とくに**株の写真に付いてきた品種は幻覚**なので必ず落とす。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import {
  IDENTIFY_SYSTEM_PROMPT_FOR_TESTING,
  type IdentifyVisionInput,
  type IdentifyVisionProvider,
} from '../lib/identify-vision.js';
import { setIdentifyProviderForTesting } from '../routes/garden.js';

const TINY_BASE64 = Buffer.from('fake-jpeg-bytes').toString('base64');

function post(body: unknown, headers: Record<string, string> = {}) {
  return app.request('/api/v1/garden/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => resetRateLimitForTesting());
afterEach(() => setIdentifyProviderForTesting(null));

describe('POST /api/v1/garden/identify', () => {
  it('ラベルからは作物名・品種・植え方まで返す', async () => {
    let received: IdentifyVisionInput | null = null;
    setIdentifyProviderForTesting({
      analyze: async (input) => {
        received = input;
        return {
          found: true,
          source: 'label',
          cropGuess: 'ミニトマト',
          cropConfidence: 'high',
          variety: 'アイコ',
          plantedAs: 'seed',
        };
      },
    } as IdentifyVisionProvider);

    const res = await post({
      imageBase64: TINY_BASE64,
      mimeType: 'image/jpeg',
      knownCrops: ['ミニトマト', 'キュウリ'],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      found: true,
      source: 'label',
      cropGuess: 'ミニトマト',
      cropConfidence: 'high',
      variety: 'アイコ',
      plantedAs: 'seed',
    });
    // 作物マスターがそのままプロバイダへ渡ること（表記ゆれを抑える手がかり）
    expect(received).toMatchObject({ knownCrops: ['ミニトマト', 'キュウリ'] });
  });

  // 株の外見から品種は決まらない。プロンプトでも禁じているが、
  // モデルが返してきても**境界で落とす**（幻覚が台帳に載るのを防ぐ）。
  it('株の写真に品種が付いてきても落とす', async () => {
    setIdentifyProviderForTesting({
      analyze: async () => ({
        found: true,
        source: 'plant',
        cropGuess: 'ミニトマト',
        cropConfidence: 'medium',
        variety: 'アイコ',
        plantedAs: 'seedling',
      }),
    } as IdentifyVisionProvider);

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.data.cropGuess).toBe('ミニトマト');
    expect(body.data.variety).toBeUndefined();
    expect(body.data.plantedAs).toBeUndefined();
  });

  it('作物名が無ければ found=false に落とす（空の下書きを作らせない）', async () => {
    setIdentifyProviderForTesting({
      analyze: async () => ({
        found: true,
        source: 'plant',
        cropConfidence: 'low',
        note: '双葉のみで判別が難しいです',
      }),
    } as IdentifyVisionProvider);

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.data.found).toBe(false);
    expect(body.data.cropGuess).toBeUndefined();
    expect(body.data.note).toBe('双葉のみで判別が難しいです');
  });

  it('作物が写っていなければ found=false で他は空', async () => {
    setIdentifyProviderForTesting({
      analyze: async () => ({ found: false, cropGuess: 'ミニトマト', variety: 'アイコ' }),
    } as IdentifyVisionProvider);

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.data).toEqual({ found: false });
  });

  it('長すぎる作物名・品種は切り詰める', async () => {
    setIdentifyProviderForTesting({
      analyze: async () => ({
        found: true,
        source: 'label',
        cropGuess: 'あ'.repeat(120),
        variety: 'い'.repeat(120),
      }),
    } as IdentifyVisionProvider);

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    const body = (await res.json()) as {
      ok: boolean;
      data: { cropGuess: string; variety: string };
    };
    expect(body.data.cropGuess).toHaveLength(50);
    expect(body.data.variety).toHaveLength(50);
  });

  it('knownCrops なしでも動く', async () => {
    let received: IdentifyVisionInput | null = null;
    setIdentifyProviderForTesting({
      analyze: async (input) => {
        received = input;
        return { found: true, source: 'plant', cropGuess: 'キュウリ' };
      },
    } as IdentifyVisionProvider);

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(received).not.toBeNull();
    expect(received).not.toHaveProperty('knownCrops');
  });

  it('画像が無ければ検証で弾く', async () => {
    const res = await post({ mimeType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  it('knownCrops が多すぎれば検証で弾く', async () => {
    const res = await post({
      imageBase64: TINY_BASE64,
      mimeType: 'image/jpeg',
      knownCrops: Array.from({ length: 41 }, (_, i) => `作物${i}`),
    });
    expect(res.status).toBe(400);
  });

  it('provider が投げたら ok:false（手入力へ案内する）', async () => {
    setIdentifyProviderForTesting({
      analyze: async () => {
        throw new Error('boom');
      },
    } as IdentifyVisionProvider);

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AI_INFER_FAILED');
    expect(body.error.message).toContain('手で入力');
  });

  // 登録は相談・収穫とプールを分けてある。混ざっていないことを確かめる
  // （初回の一括登録が日常の相談を締め出さないため）。
  it('登録専用のプールでレート制限される', async () => {
    setIdentifyProviderForTesting({
      analyze: async () => ({ found: true, source: 'plant', cropGuess: 'キュウリ' }),
    } as IdentifyVisionProvider);

    const ip = '203.0.113.77';
    const limit = 30; // IDENTIFY_POOL.clientDefault
    for (let i = 0; i < limit; i++) {
      const ok = await post(
        { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' },
        { 'x-forwarded-for': ip },
      );
      const body = (await ok.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    }
    const blocked = await post(
      { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' },
      { 'x-forwarded-for': ip },
    );
    const body = (await blocked.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');

    // 相談は別プールなので巻き添えにならない
    const consult = await app.request('/api/v1/garden/consult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' }),
    });
    const consultBody = (await consult.json()) as { ok: boolean; error?: { code: string } };
    expect(consultBody.error?.code).not.toBe('RATE_LIMITED');
  });
});

describe('identify のプロンプト', () => {
  // 品種を株から創作させない指示は、この機能の正しさの前提。
  it('株の写真では品種を返さないよう指示している', () => {
    expect(IDENTIFY_SYSTEM_PROMPT_FOR_TESTING).toContain('variety は返しません');
  });

  it('ラベルは推測で補わないよう指示している', () => {
    expect(IDENTIFY_SYSTEM_PROMPT_FOR_TESTING).toContain('推測で補いません');
  });

  it('作物名に括弧の補足を足さないよう指示している', () => {
    // 実測で consult は「エダマメ（大豆）」を返した。登録名としては使いにくい。
    expect(IDENTIFY_SYSTEM_PROMPT_FOR_TESTING).toContain('補足を括弧で足しません');
  });
});
