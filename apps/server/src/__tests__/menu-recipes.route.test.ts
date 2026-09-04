/**
 * 献立の不足分レシピの一括生成（POST /api/v1/infer/menu-recipes）。
 * docs/買い物リスト・在庫設計.md §10.12（M3）。
 *
 * ここで守りたいのは 3 つ。
 * 1. `sanitizeMenuRecipeDrafts` の規則が route を通しても効くこと
 *    （半端な下書きは捨てる・手持ちと同名は捨てる・days を超えたら捨てる・全滅は ok:false）。
 * 2. **チェック順が本質**: 月次枠（無料のローカル読み）→ 共有レートプール
 *    （/infer/menu と同じ。枠切れの連打が共有プールを消費してはいけない）。
 * 3. `x-quota-source: token|premium` は月次枠だけを飛ばす。消費は成功時のみ。
 */
import { beforeEach, describe, expect, it } from 'vitest';

process.env['INFER_QUOTA_DB_PATH'] = ':memory:';

import app from '../index.js';
import { setMenuRecipesProviderForTesting } from '../routes/infer.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import { resetQuotaStoreForTesting } from '../lib/quota-store.js';
import {
  MenuRecipesQuotaError,
  buildMenuRecipesContext,
  buildMenuRecipesResponseSchema,
  sanitizeMenuRecipeDrafts,
  type MenuRecipesInput,
  type MenuRecipesProvider,
  type MenuRecipesRaw,
} from '../lib/menu-recipes.js';

function stub(
  reply: (input: MenuRecipesInput) => MenuRecipesRaw | Promise<MenuRecipesRaw>,
): MenuRecipesProvider {
  return { generate: async (input) => reply(input) };
}

const DEVICE_ID = 'device-abcdefgh01';

function draft(title: string) {
  return {
    title,
    description: '平日向けの一品',
    ingredients: [{ name: '鶏むね肉', amount: '1枚' }],
    steps: [{ body: '焼く' }],
  };
}

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request('/api/v1/infer/menu-recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID, ...headers },
    body: JSON.stringify(body),
  });
}

interface ResultDraft {
  title: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients: { name: string; amount?: string }[];
  steps: { body: string }[];
  tags?: string[];
}

type MenuRecipesResult =
  | { ok: true; data: { recipes: ResultDraft[] } }
  | { ok: false; error: { code: string; retryable: boolean } };

const ENV_KEYS = ['INFER_GLOBAL_DAILY_LIMIT', 'INFER_DAILY_LIMIT', 'INFER_MONTHLY_FREE_LIMIT'];

beforeEach(() => {
  setMenuRecipesProviderForTesting(null);
  resetRateLimitForTesting();
  resetQuotaStoreForTesting();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('POST /api/v1/infer/menu-recipes — 検証（sanitizeMenuRecipeDrafts）', () => {
  it('n 品返れば n 品そのまま返す', async () => {
    setMenuRecipesProviderForTesting(
      stub(() => ({ recipes: [draft('照り焼き'), draft('麻婆豆腐')] })),
    );
    const res = await post({ days: 2, existingTitles: [], pantry: [] });
    const json = (await res.json()) as MenuRecipesResult;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.recipes.map((r) => r.title)).toEqual(['照り焼き', '麻婆豆腐']);
    }
  });

  it('材料か手順が空の品は捨てる（半端な下書きは保存できない）', async () => {
    setMenuRecipesProviderForTesting(
      stub(() => ({
        recipes: [
          { title: '材料なし', ingredients: [], steps: [{ body: '焼く' }] },
          { title: '手順なし', ingredients: [{ name: '卵' }], steps: [] },
          draft('生き残る一品'),
        ],
      })),
    );
    const res = await post({ days: 3, existingTitles: [], pantry: [] });
    const json = (await res.json()) as MenuRecipesResult;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.recipes.map((r) => r.title)).toEqual(['生き残る一品']);
    }
  });

  it('手持ちレシピと同名（空白・大小の差を無視）の品は捨てる — 重複回避の決定的防御', async () => {
    setMenuRecipesProviderForTesting(
      stub(() => ({ recipes: [draft('肉じゃが'), draft('新しい一品')] })),
    );
    const res = await post({ days: 2, existingTitles: ['肉 じゃが'], pantry: [] });
    const json = (await res.json()) as MenuRecipesResult;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.recipes.map((r) => r.title)).toEqual(['新しい一品']);
    }
  });

  it('生成結果同士の同名は 2 品目以降を捨てる', async () => {
    setMenuRecipesProviderForTesting(
      stub(() => ({ recipes: [draft('カレー'), draft('カレー'), draft('シチュー')] })),
    );
    const res = await post({ days: 3, existingTitles: [], pantry: [] });
    const json = (await res.json()) as MenuRecipesResult;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.recipes.map((r) => r.title)).toEqual(['カレー', 'シチュー']);
    }
  });

  it('days を超えて返っても先頭から days 品だけ返す', async () => {
    setMenuRecipesProviderForTesting(
      stub(() => ({ recipes: [draft('一品目'), draft('二品目'), draft('三品目')] })),
    );
    const res = await post({ days: 2, existingTitles: [], pantry: [] });
    const json = (await res.json()) as MenuRecipesResult;

    expect(json.ok).toBe(true);
    if (json.ok) expect(json.data.recipes).toHaveLength(2);
  });

  it('全滅したら ok:false MENU_RECIPES_FAILED（空を AI の顔で返さない）', async () => {
    setMenuRecipesProviderForTesting(
      stub(() => ({ recipes: [{ title: '', ingredients: [], steps: [] }] })),
    );
    const res = await post({ days: 1, existingTitles: [], pantry: [] });
    const json = (await res.json()) as MenuRecipesResult;

    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('MENU_RECIPES_FAILED');
      expect(json.error.retryable).toBe(true);
    }
  });

  it('"null" という文字列のフィールドは空として扱う（構造化出力の実測挙動への防御）', async () => {
    setMenuRecipesProviderForTesting(
      stub(() => ({
        recipes: [
          {
            title: '一品',
            description: 'null',
            ingredients: [{ name: '卵', amount: 'undefined' }],
            steps: [{ body: '焼く' }],
          },
        ],
      })),
    );
    const res = await post({ days: 1, existingTitles: [], pantry: [] });
    const json = (await res.json()) as MenuRecipesResult;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.recipes[0]).not.toHaveProperty('description');
      expect(json.data.recipes[0]?.ingredients[0]).not.toHaveProperty('amount');
    }
  });
});

describe('POST /api/v1/infer/menu-recipes — エラー写像・枠', () => {
  it('上流の利用枠切れは AI_QUOTA_EXCEEDED', async () => {
    setMenuRecipesProviderForTesting({
      generate: async () => {
        throw new MenuRecipesQuotaError('quota');
      },
    });
    const res = await post({ days: 1, existingTitles: [], pantry: [] });
    const json = (await res.json()) as MenuRecipesResult;

    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('AI_QUOTA_EXCEEDED');
      expect(json.error.retryable).toBe(false);
    }
  });

  it('月次無料枠を使い切ると FREE_QUOTA_EXCEEDED（一括 = 1 消費・M3-3）', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    setMenuRecipesProviderForTesting(stub(() => ({ recipes: [draft('一品')] })));

    const first = (await (
      await post({ days: 1, existingTitles: [], pantry: [] })
    ).json()) as MenuRecipesResult;
    expect(first.ok).toBe(true);

    const second = (await (
      await post({ days: 1, existingTitles: [], pantry: [] })
    ).json()) as MenuRecipesResult;
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('FREE_QUOTA_EXCEEDED');
      expect(second.error.retryable).toBe(false);
    }
  });

  it('n=7 でも消費は 1 回分（days は消費数に影響しない）', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '2';
    setMenuRecipesProviderForTesting(
      stub((input) => ({
        recipes: Array.from({ length: input.days }, (_, i) => draft(`一品${i}`)),
      })),
    );

    // 7 品の一括でも 1 消費 → 2 回目も通り、3 回目で尽きる
    const first = (await (
      await post({ days: 7, existingTitles: [], pantry: [] })
    ).json()) as MenuRecipesResult;
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.recipes).toHaveLength(7);

    const second = (await (
      await post({ days: 7, existingTitles: [], pantry: [] })
    ).json()) as MenuRecipesResult;
    expect(second.ok).toBe(true);

    const third = (await (
      await post({ days: 7, existingTitles: [], pantry: [] })
    ).json()) as MenuRecipesResult;
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe('FREE_QUOTA_EXCEEDED');
  });

  it('提案が全滅（ok:false）なら月次枠を消費しない', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    setMenuRecipesProviderForTesting(
      stub(() => ({ recipes: [{ title: '', ingredients: [], steps: [] }] })),
    );

    const failed = (await (
      await post({ days: 1, existingTitles: [], pantry: [] })
    ).json()) as MenuRecipesResult;
    expect(failed.ok).toBe(false);

    // 失敗で枠が減っていなければ、まともな提案が返る 2 回目は成功する
    setMenuRecipesProviderForTesting(stub(() => ({ recipes: [draft('一品')] })));
    const second = (await (
      await post({ days: 1, existingTitles: [], pantry: [] })
    ).json()) as MenuRecipesResult;
    expect(second.ok).toBe(true);
  });

  it('月次枠切れの連打は共有プールを消費しない（チェック順の固定・/menu と同じ）', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '3';
    setMenuRecipesProviderForTesting(stub(() => ({ recipes: [draft('一品')] })));

    const first = (await (
      await post({ days: 1, existingTitles: [], pantry: [] })
    ).json()) as MenuRecipesResult;
    expect(first.ok).toBe(true);

    for (let i = 0; i < 5; i += 1) {
      const res = (await (
        await post({ days: 1, existingTitles: [], pantry: [] })
      ).json()) as MenuRecipesResult;
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('FREE_QUOTA_EXCEEDED');
    }

    // token で月次枠を飛ばすと、共有プールは 3 のうち 1 しか使われていない
    const token1 = (await (
      await post({ days: 1, existingTitles: [], pantry: [] }, { 'x-quota-source': 'token' })
    ).json()) as MenuRecipesResult;
    expect(token1.ok).toBe(true);

    const token2 = (await (
      await post({ days: 1, existingTitles: [], pantry: [] }, { 'x-quota-source': 'token' })
    ).json()) as MenuRecipesResult;
    expect(token2.ok).toBe(true);

    const token3 = (await (
      await post({ days: 1, existingTitles: [], pantry: [] }, { 'x-quota-source': 'token' })
    ).json()) as MenuRecipesResult;
    expect(token3.ok).toBe(false);
    if (!token3.ok) expect(token3.error.code).toBe('RATE_LIMITED');
  });

  it('x-quota-source: premium は月次枠チェックを飛ばす', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    setMenuRecipesProviderForTesting(stub(() => ({ recipes: [draft('一品')] })));

    await post({ days: 1, existingTitles: [], pantry: [] }); // 枠を使い切る
    const viaPremium = (await (
      await post({ days: 1, existingTitles: [], pantry: [] }, { 'x-quota-source': 'premium' })
    ).json()) as MenuRecipesResult;
    expect(viaPremium.ok).toBe(true);
  });

  it('未知の x-quota-source は無視して通常判定に落ちる', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    setMenuRecipesProviderForTesting(stub(() => ({ recipes: [draft('一品')] })));

    await post({ days: 1, existingTitles: [], pantry: [] }); // 枠を使い切る
    const res = (await (
      await post({ days: 1, existingTitles: [], pantry: [] }, { 'x-quota-source': 'bogus' })
    ).json()) as MenuRecipesResult;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('FREE_QUOTA_EXCEEDED');
  });
});

describe('POST /api/v1/infer/menu-recipes — 入力', () => {
  it('x-device-id が無いなら受け付けない', async () => {
    setMenuRecipesProviderForTesting(stub(() => ({ recipes: [draft('一品')] })));
    const res = await app.request('/api/v1/infer/menu-recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // x-device-id 無し
      body: JSON.stringify({ days: 1, existingTitles: [], pantry: [] }),
    });
    const json = (await res.json()) as MenuRecipesResult;
    expect(json.ok).toBe(false);
  });

  it.each([0, 8, 1.5])('days=%s は 400（zod・1〜7 の整数のみ）', async (days) => {
    const res = await post({ days, existingTitles: [], pantry: [] });
    expect(res.status).toBe(400);
  });

  it('嗜好メモが 400 字を超えると 400（zod）', async () => {
    const res = await post({
      days: 1,
      existingTitles: [],
      pantry: [],
      preferences: 'あ'.repeat(401),
    });
    expect(res.status).toBe(400);
  });

  it('タイトル 31 件・在庫 51 件は 400（zod）', async () => {
    const tooManyTitles = await post({
      days: 1,
      existingTitles: Array.from({ length: 31 }, (_, i) => `t${i}`),
      pantry: [],
    });
    expect(tooManyTitles.status).toBe(400);

    const tooManyPantry = await post({
      days: 1,
      existingTitles: [],
      pantry: Array.from({ length: 51 }, (_, i) => `p${i}`),
    });
    expect(tooManyPantry.status).toBe(400);
  });
});

describe('コンテキストの組み立て・スキーマ', () => {
  it('品数・手持ち・在庫・好みを 1 つのメッセージにまとめる', () => {
    const text = buildMenuRecipesContext({
      days: 3,
      existingTitles: ['肉じゃが'],
      pantry: ['卵'],
      preferences: '義母は洋食を食べない',
    });
    expect(text).toContain('## 作る品数');
    expect(text).toContain('3');
    expect(text).toContain('肉じゃが');
    expect(text).toContain('卵');
    expect(text).toContain('義母は洋食を食べない');
  });

  it('手持ち・在庫・好みが無ければ「無い」ことを明示する', () => {
    const text = buildMenuRecipesContext({ days: 1, existingTitles: [], pantry: [] });
    expect(text).toContain('（まだ無い）');
    expect(text).toContain('（在庫は空）');
    expect(text).toContain('（指定なし）');
  });

  it('recipes は必須。各品は title/ingredients/steps が必須', () => {
    const schema = buildMenuRecipesResponseSchema();
    expect(schema.required).toContain('recipes');
    expect(schema.properties.recipes.items.required).toEqual(['title', 'ingredients', 'steps']);
  });

  it('sanitizeMenuRecipeDrafts は null/undefined でも落ちない（空扱い）', () => {
    expect(sanitizeMenuRecipeDrafts(null, [], 3)).toEqual([]);
    expect(sanitizeMenuRecipeDrafts(undefined, [], 3)).toEqual([]);
  });
});
