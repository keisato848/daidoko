/**
 * 冷蔵庫写真の読み取り（POST /api/v1/infer/fridge）。docs/冷蔵庫写真設計.md。
 *
 * ここで守りたいのは 4 つ。
 * 1. `sanitizeFridgeItems` の規則が route を通しても効くこと
 *    （品名なしは捨てる・confidence は 0〜1 に丸める・同名は高い方を残す・分量欄は無い）。
 * 2. **チェック順が本質**: 月次枠（無料のローカル読み）→ 共有レートプール
 *    （/infer/menu-recipes と同じ。枠切れの連打が共有プールを消費してはいけない）。
 * 3. `x-quota-source: token|premium` は月次枠だけを飛ばす。消費は provider 成功時のみ。
 * 4. 空の読み取り結果（items: []）はエラーではなく ok:true — 判定はクライアント側。
 */
import { beforeEach, describe, expect, it } from 'vitest';

process.env['INFER_QUOTA_DB_PATH'] = ':memory:';

import app from '../index.js';
import { setFridgeProviderForTesting } from '../routes/infer.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import { resetQuotaStoreForTesting } from '../lib/quota-store.js';
import {
  FRIDGE_SYSTEM_PROMPT,
  FridgeVisionRequestError,
  sanitizeFridgeItems,
  type FridgeVisionInput,
  type FridgeVisionProvider,
  type FridgeVisionRaw,
} from '../lib/fridge-vision.js';

function stub(
  reply: (input: FridgeVisionInput) => FridgeVisionRaw | Promise<FridgeVisionRaw>,
): FridgeVisionProvider {
  return { infer: async (input) => reply(input) };
}

const DEVICE_ID = 'device-abcdefgh01';
const TINY_BASE64 = Buffer.from('fake-jpeg-bytes').toString('base64');
const IMAGE = { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' };

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request('/api/v1/infer/fridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID, ...headers },
    body: JSON.stringify(body),
  });
}

type FridgeResult =
  | { ok: true; data: { items: { name: string; confidence: number }[] } }
  | { ok: false; error: { code: string; retryable: boolean } };

const ENV_KEYS = ['INFER_GLOBAL_DAILY_LIMIT', 'INFER_DAILY_LIMIT', 'INFER_MONTHLY_FREE_LIMIT'];

beforeEach(() => {
  setFridgeProviderForTesting(null);
  resetRateLimitForTesting();
  resetQuotaStoreForTesting();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('sanitizeFridgeItems — 捨てる方向のみ・埋めない', () => {
  it('品名なし・空文字は捨てる', () => {
    expect(
      sanitizeFridgeItems({ items: [{ confidence: 0.9 }, { name: '  ', confidence: 0.9 }] }),
    ).toEqual([]);
  });

  it('confidence は 0〜1 に丸め、数値でなければ 0（要確認側へ倒す）', () => {
    const items = sanitizeFridgeItems({
      items: [
        { name: '牛乳', confidence: 1.4 },
        { name: '卵', confidence: -0.2 },
        { name: '味噌' },
      ],
    });
    expect(items).toEqual([
      { name: '牛乳', confidence: 1 },
      { name: '卵', confidence: 0 },
      { name: '味噌', confidence: 0 },
    ]);
  });

  it('同名（全半角・カナ/かな・空白の差を無視）は confidence が高い方を残す', () => {
    const items = sanitizeFridgeItems({
      items: [
        { name: 'とうふ', confidence: 0.4 },
        { name: 'トウフ', confidence: 0.9 },
        { name: 'ﾄｳﾌ', confidence: 0.6 },
      ],
    });
    expect(items).toEqual([{ name: 'トウフ', confidence: 0.9 }]);
  });

  it('上限（60 品）を超えたぶんは捨てる', () => {
    const raw = {
      items: Array.from({ length: 70 }, (_, i) => ({ name: `品目${i}`, confidence: 0.5 })),
    };
    expect(sanitizeFridgeItems(raw)).toHaveLength(60);
  });

  it('raw が null/undefined でも落ちない（空扱い）', () => {
    expect(sanitizeFridgeItems(null)).toEqual([]);
    expect(sanitizeFridgeItems(undefined)).toEqual([]);
  });

  // ペルソナ検証（2026-09-05）: 実写真 11 品中 3 品が「調味料」「飲料」等の
  // カテゴリ名で、5 人全員が「在庫として役に立たない」と一致（設計 §9）
  it('カテゴリ語は捨てずに confidence 0（要確認）へ落とす', () => {
    const items = sanitizeFridgeItems({
      items: [
        { name: '調味料', confidence: 0.9 },
        { name: '飲料', confidence: 0.85 },
        { name: 'Condiments', confidence: 0.9 },
        { name: '牛乳', confidence: 0.9 },
      ],
    });
    expect(items).toEqual([
      { name: '調味料', confidence: 0 },
      { name: '飲料', confidence: 0 },
      { name: 'Condiments', confidence: 0 },
      { name: '牛乳', confidence: 0.9 },
    ]);
  });

  it('カテゴリ語は単体一致のみ — 複合語（調味料入れ 等）は対象外', () => {
    const items = sanitizeFridgeItems({
      items: [
        { name: '調味料入れ', confidence: 0.7 },
        { name: '野菜ジュース', confidence: 0.8 },
      ],
    });
    expect(items).toEqual([
      { name: '調味料入れ', confidence: 0.7 },
      { name: '野菜ジュース', confidence: 0.8 },
    ]);
  });
});

describe('FRIDGE_SYSTEM_PROMPT — カテゴリ名の禁止（ペルソナ検証 2026-09-05）', () => {
  it('カテゴリ名を返さない指示と具体名への言い換え例を含む', () => {
    expect(FRIDGE_SYSTEM_PROMPT).toContain('カテゴリ名は品目として返しません');
    expect(FRIDGE_SYSTEM_PROMPT).toContain('×調味料 → ○醤油・みりん');
    expect(FRIDGE_SYSTEM_PROMPT).toContain('×飲料 → ○麦茶・牛乳');
  });
});

describe('POST /api/v1/infer/fridge — バリデーション', () => {
  it('画像がなければ 400', async () => {
    const res = await post({ images: [] });
    expect(res.status).toBe(400);
  });

  it('3 枚は 400（契約は 1〜2 枚）', async () => {
    const res = await post({ images: [IMAGE, IMAGE, IMAGE] });
    expect(res.status).toBe(400);
  });

  it('未対応の mimeType は 400', async () => {
    const res = await post({ images: [{ imageBase64: TINY_BASE64, mimeType: 'image/gif' }] });
    expect(res.status).toBe(400);
  });

  it('x-device-id が無いと ok:false（推論もレート消費もしない）', async () => {
    let called = 0;
    setFridgeProviderForTesting(
      stub(() => {
        called += 1;
        return { items: [] };
      }),
    );
    const res = await app.request('/api/v1/infer/fridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [IMAGE] }),
    });
    const json = (await res.json()) as FridgeResult;
    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.error.code).toBe('UNKNOWN');
    expect(called).toBe(0);
  });
});

describe('POST /api/v1/infer/fridge — 成功ケース', () => {
  it('品目と confidence を返す（分量・数量の欄は無い）', async () => {
    setFridgeProviderForTesting(
      stub(() => ({
        items: [
          { name: '牛乳', confidence: 0.95 },
          { name: 'にんじん', confidence: 0.6 },
          { name: '味噌', confidence: 0.3 },
        ],
      })),
    );
    const res = await post({ images: [IMAGE] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as FridgeResult;
    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.items).toEqual([
        { name: '牛乳', confidence: 0.95 },
        { name: 'にんじん', confidence: 0.6 },
        { name: '味噌', confidence: 0.3 },
      ]);
      expect(json.data.items[0]).not.toHaveProperty('quantity');
    }
  });

  it('2 枚の画像がそのまま provider に渡る', async () => {
    let seen: FridgeVisionInput | null = null;
    setFridgeProviderForTesting(
      stub((input) => {
        seen = input;
        return { items: [] };
      }),
    );
    await post({ images: [IMAGE, { imageBase64: TINY_BASE64, mimeType: 'image/png' }] });
    expect(seen).not.toBeNull();
    expect((seen as unknown as FridgeVisionInput).images).toHaveLength(2);
  });

  it('読み取り 0 件でも ok:true（食材なしの判定・文言はクライアント側）', async () => {
    setFridgeProviderForTesting(stub(() => ({ items: [] })));
    const res = await post({ images: [IMAGE] });
    const json = (await res.json()) as FridgeResult;
    expect(json.ok).toBe(true);
    if (json.ok) expect(json.data.items).toEqual([]);
  });
});

describe('POST /api/v1/infer/fridge — 月次無料枠（/menu-recipes と同じ作法）', () => {
  it('枠切れは FREE_QUOTA_EXCEEDED（provider は呼ばれない）', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    let called = 0;
    setFridgeProviderForTesting(
      stub(() => {
        called += 1;
        return { items: [{ name: '牛乳', confidence: 0.9 }] };
      }),
    );

    const first = (await (await post({ images: [IMAGE] })).json()) as FridgeResult;
    expect(first.ok).toBe(true);

    const second = (await (await post({ images: [IMAGE] })).json()) as FridgeResult;
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('FREE_QUOTA_EXCEEDED');
    expect(called).toBe(1);
  });

  it('x-quota-source: token は月次枠を飛ばし、消費も記録しない', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    setFridgeProviderForTesting(stub(() => ({ items: [{ name: '牛乳', confidence: 0.9 }] })));

    // トークン実行を 2 回 — 月次枠 1 でも両方通る（枠を読まないし、消費もしない）
    for (let i = 0; i < 2; i++) {
      const json = (await (
        await post({ images: [IMAGE] }, { 'x-quota-source': 'token' })
      ).json()) as FridgeResult;
      expect(json.ok).toBe(true);
    }
    // その後の通常実行も、枠が無傷なので 1 回は通る
    const normal = (await (await post({ images: [IMAGE] })).json()) as FridgeResult;
    expect(normal.ok).toBe(true);
  });

  it('provider 失敗時は月次枠を消費しない', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    setFridgeProviderForTesting(
      stub(() => {
        throw new FridgeVisionRequestError('boom');
      }),
    );
    const failed = (await (await post({ images: [IMAGE] })).json()) as FridgeResult;
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.code).toBe('AI_INFER_FAILED');
      expect(failed.error.retryable).toBe(true);
    }

    // 失敗で枠が減っていなければ、成功する provider に替えた 1 回目は通る
    setFridgeProviderForTesting(stub(() => ({ items: [{ name: '牛乳', confidence: 0.9 }] })));
    const retried = (await (await post({ images: [IMAGE] })).json()) as FridgeResult;
    expect(retried.ok).toBe(true);
  });
});

describe('POST /api/v1/infer/fridge — レート制限（photo/receipt と同じ共有プール）', () => {
  it('global 上限超過で RATE_LIMITED', async () => {
    process.env['INFER_DAILY_LIMIT'] = '0';
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '2';
    setFridgeProviderForTesting(stub(() => ({ items: [] })));
    let lastBody: FridgeResult = { ok: true, data: { items: [] } };
    for (let i = 0; i < 3; i++) {
      const res = await post({ images: [IMAGE] }, { 'x-forwarded-for': `10.2.0.${i + 1}` });
      lastBody = (await res.json()) as FridgeResult;
    }
    expect(lastBody.ok).toBe(false);
    if (!lastBody.ok) expect(lastBody.error.code).toBe('RATE_LIMITED');
  });
});
