/**
 * POST /api/v1/garden/harvest（さいえん手帳の収穫の写真記録・saien-techo#143）。
 *
 * **この機能の肝は「数えられないものを数えないこと」。** 収穫記録の数量は
 * ユーザーの台帳に載る値なので、当てずっぽうの数字を入れるくらいなら
 * 空のままの方がよい（`HarvestItem.quantity` は元から nullable）。
 * モデルが妙な値を返しても素通ししないことを、ここで見張る。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import {
  HARVEST_SYSTEM_PROMPT_FOR_TESTING,
  sanitize,
  type HarvestVisionInput,
  type HarvestVisionProvider,
  type HarvestVisionRaw,
} from '../lib/harvest-vision.js';
import { setHarvestProviderForTesting } from '../routes/garden.js';

const TINY_BASE64 = Buffer.from('fake-jpeg-bytes').toString('base64');

function post(body: unknown) {
  return app.request('/api/v1/garden/harvest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function stub(fn: (input: HarvestVisionInput) => Promise<HarvestVisionRaw>): void {
  const provider: HarvestVisionProvider = { analyze: fn };
  setHarvestProviderForTesting(provider);
}

beforeEach(() => {
  resetRateLimitForTesting();
  for (const key of ['HARVEST_GLOBAL_DAILY_LIMIT', 'HARVEST_DAILY_LIMIT']) delete process.env[key];
});

afterEach(() => {
  setHarvestProviderForTesting(null);
});

describe('POST /api/v1/garden/harvest', () => {
  it('作物と個数を返す', async () => {
    stub(async () => ({
      isHarvest: true,
      cropGuess: 'キュウリ',
      cropConfidence: 'high',
      count: 3,
      countConfidence: 'high',
    }));

    const res = await post({
      imageBase64: TINY_BASE64,
      mimeType: 'image/jpeg',
      cropName: 'キュウリ',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: HarvestVisionRaw };
    expect(body.ok).toBe(true);
    expect(body.data?.cropGuess).toBe('キュウリ');
    expect(body.data?.count).toBe(3);
  });

  it('数えられないときは count を返さず、理由が付く', async () => {
    stub(async () => ({
      isHarvest: true,
      cropGuess: 'ミニトマト',
      cropConfidence: 'high',
      note: '重なっていて数えられませんでした',
    }));

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    const body = (await res.json()) as { ok: boolean; data?: HarvestVisionRaw };
    expect(body.data?.count).toBeUndefined();
    expect(body.data?.note).toContain('数えられません');
  });

  it('収穫物が写っていなければ他は空', async () => {
    stub(async () => ({ isHarvest: false, cropGuess: 'これは無視される', count: 99 }));

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    const body = (await res.json()) as { ok: boolean; data?: HarvestVisionRaw };
    expect(body.data).toEqual({ isHarvest: false });
  });

  it('cropName を推定のヒントとして provider へ渡す', async () => {
    let seen: string | undefined;
    stub(async (input) => {
      seen = input.cropName;
      return { isHarvest: true };
    });

    await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg', cropName: 'ナス' });
    expect(seen).toBe('ナス');
  });

  it('provider が落ちても 200 + ok:false で返し、手入力を案内する', async () => {
    stub(async () => {
      throw new Error('boom');
    });

    const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: { message: string } };
    expect(body.ok).toBe(false);
    // 失敗しても記録そのものは続けられる、と伝わる文言であること
    expect(body.error?.message).toContain('手で入力');
  });

  it('上限に達したら RATE_LIMITED', async () => {
    process.env['HARVEST_GLOBAL_DAILY_LIMIT'] = '1';
    stub(async () => ({ isHarvest: true }));

    expect(
      (await (await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' })).json()) as {
        ok: boolean;
      },
    ).toMatchObject({ ok: true });
    const second = (await (
      await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' })
    ).json()) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe('RATE_LIMITED');
  });
});

describe('sanitize — 台帳に載る値なので素通ししない', () => {
  it.each([
    ['0 個', 0],
    ['負数', -3],
    ['小数', 2.5],
    ['桁外れ', 100_000],
  ])('%s は落とす', (_label, count) => {
    const out = sanitize({ isHarvest: true, count: count as number });
    expect(out.count).toBeUndefined();
  });

  it('妥当な個数は通す', () => {
    expect(sanitize({ isHarvest: true, count: 12 }).count).toBe(12);
  });

  it('長すぎる作物名・メモは切り詰める', () => {
    const out = sanitize({
      isHarvest: true,
      cropGuess: 'あ'.repeat(100),
      note: 'い'.repeat(500),
    });
    expect(out.cropGuess?.length).toBe(50);
    expect(out.note?.length).toBe(200);
  });
});

describe('プロンプト', () => {
  it('「推測で数を出さない」と明示している', () => {
    // ここが緩むと、当てずっぽうの数字が台帳に入る。文言ごと見張る。
    expect(HARVEST_SYSTEM_PROMPT_FOR_TESTING).toContain('推測で数を出してはいけません');
  });

  it('束・重さで量るものは数えないと明示している', () => {
    expect(HARVEST_SYSTEM_PROMPT_FOR_TESTING).toContain('束');
    expect(HARVEST_SYSTEM_PROMPT_FOR_TESTING).toContain('count を返しません');
  });

  it('可食判断をしないと明示している', () => {
    expect(HARVEST_SYSTEM_PROMPT_FOR_TESTING).toContain('可食判断');
  });

  it('株に付いたままの実は収穫物でないと明示している', () => {
    // これが緩むと、畑の株を撮っただけで「収穫 2 個」が台帳に入る
    // （スモークテストで実際に起きた — 鉢植えの株の写真に count:2 が返った）。
    expect(HARVEST_SYSTEM_PROMPT_FOR_TESTING).toContain('株に付いたままの実は収穫物ではありません');
    expect(HARVEST_SYSTEM_PROMPT_FOR_TESTING).toContain('株から切り離してある');
  });

  it('ヒントの作物だけを数えると明示している', () => {
    // その日の収穫を全部並べた写真（複数作物）は普通に起きる。
    // 記録先の栽培は決まっているので、他の作物を count に混ぜてはいけない。
    expect(HARVEST_SYSTEM_PROMPT_FOR_TESTING).toContain('その作物だけを数えます');
  });
});
