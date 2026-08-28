/**
 * 献立の並べ替え（POST /api/v1/infer/menu）。docs/買い物リスト・在庫設計.md §10.10。
 *
 * ここで守りたいのは 3 つ。
 * 1. `sanitizeMenuDays` の 6 規則が route を通しても効くこと（§10.10.3）。
 * 2. **チェック順が本質**: 月次枠（無料のローカル読み）→ 共有レートプール。
 *    枠切れの連打が共有プール（INFER_GLOBAL_DAILY_LIMIT）を消費してはいけない。
 * 3. `x-quota-source: token|premium` は月次枠だけを飛ばす（共有プールは通常どおり）。
 *    未知の値は無視して通常判定に落ちる。
 */
import { beforeEach, describe, expect, it } from 'vitest';

process.env['INFER_QUOTA_DB_PATH'] = ':memory:';

import app from '../index.js';
import { setMenuProviderForTesting } from '../routes/infer.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import { resetQuotaStoreForTesting } from '../lib/quota-store.js';
import {
  MenuArrangeQuotaError,
  buildMenuContext,
  buildMenuResponseSchema,
  type MenuArrangeInput,
  type MenuArrangeProvider,
  type MenuArrangeRaw,
} from '../lib/menu-arrange.js';

function stub(
  reply: (input: MenuArrangeInput) => MenuArrangeRaw | Promise<MenuArrangeRaw>,
): MenuArrangeProvider {
  return { arrange: async (input) => reply(input) };
}

const DEVICE_ID = 'device-abcdefgh01';

function candidate(id: string) {
  return { id, title: `レシピ${id}`, coveragePct: 80, missing: [] as string[] };
}

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request('/api/v1/infer/menu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID, ...headers },
    body: JSON.stringify(body),
  });
}

type MenuResult =
  | { ok: true; data: { days: { day: number; recipeId: string; why?: string }[]; note?: string } }
  | { ok: false; error: { code: string; retryable: boolean } };

const ENV_KEYS = ['INFER_GLOBAL_DAILY_LIMIT', 'INFER_DAILY_LIMIT', 'INFER_MONTHLY_FREE_LIMIT'];

beforeEach(() => {
  setMenuProviderForTesting(null);
  resetRateLimitForTesting();
  resetQuotaStoreForTesting();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('POST /api/v1/infer/menu — 検証（sanitizeMenuDays）', () => {
  it('候補に無い recipeId は落ちる（全滅なら MENU_ARRANGE_FAILED）', async () => {
    setMenuProviderForTesting(stub(() => ({ days: [{ day: 1, recipeId: 'ghost', why: 'x' }] })));
    const res = await post({ candidates: [candidate('a')], pantry: [], days: 1 });
    const json = (await res.json()) as MenuResult;

    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.error.code).toBe('MENU_ARRANGE_FAILED');
  });

  it('day が重複したら先勝ち', async () => {
    setMenuProviderForTesting(
      stub(() => ({
        days: [
          { day: 1, recipeId: 'a', why: 'さき' },
          { day: 1, recipeId: 'b', why: 'あと' },
        ],
      })),
    );
    const res = await post({ candidates: [candidate('a'), candidate('b')], pantry: [], days: 2 });
    const json = (await res.json()) as MenuResult;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.days).toEqual([{ day: 1, recipeId: 'a', why: 'さき' }]);
    }
  });

  it('day=0, 9, 1.5 は落ちる（days=7 の枠で）', async () => {
    setMenuProviderForTesting(
      stub(() => ({
        days: [
          { day: 0, recipeId: 'a', why: 'x' },
          { day: 9, recipeId: 'b', why: 'x' },
          { day: 1.5, recipeId: 'c', why: 'x' },
          { day: 3, recipeId: 'd', why: 'ok' },
        ],
      })),
    );
    const candidates = ['a', 'b', 'c', 'd'].map(candidate);
    const res = await post({ candidates, pantry: [], days: 7 });
    const json = (await res.json()) as MenuResult;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.days).toEqual([{ day: 3, recipeId: 'd', why: 'ok' }]);
    }
  });

  it('同一 recipeId が 2 日に来たら後を落とす', async () => {
    setMenuProviderForTesting(
      stub(() => ({
        days: [
          { day: 1, recipeId: 'a', why: 'さき' },
          { day: 2, recipeId: 'a', why: 'あと' },
        ],
      })),
    );
    const res = await post({ candidates: [candidate('a')], pantry: [], days: 2 });
    const json = (await res.json()) as MenuResult;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.days).toEqual([{ day: 1, recipeId: 'a', why: 'さき' }]);
    }
  });

  it('X=7 に 3 日しか返らなくても、埋めずそのまま返す', async () => {
    setMenuProviderForTesting(
      stub(() => ({
        days: [
          { day: 1, recipeId: 'a', why: 'x' },
          { day: 3, recipeId: 'b', why: 'x' },
          { day: 5, recipeId: 'c', why: 'x' },
        ],
      })),
    );
    const candidates = ['a', 'b', 'c'].map(candidate);
    const res = await post({ candidates, pantry: [], days: 7 });
    const json = (await res.json()) as MenuResult;

    expect(json.ok).toBe(true);
    if (json.ok) expect(json.data.days).toHaveLength(3);
  });

  it('全滅したら ok:false MENU_ARRANGE_FAILED（空を AI の顔で返さない）', async () => {
    // day=99 は days=1 の枠を外れるので全部落ちる
    setMenuProviderForTesting(stub(() => ({ days: [{ day: 99, recipeId: 'a', why: 'x' }] })));
    const res = await post({ candidates: [candidate('a')], pantry: [], days: 1 });
    const json = (await res.json()) as MenuResult;

    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('MENU_ARRANGE_FAILED');
      expect(json.error.retryable).toBe(true);
    }
  });
});

describe('POST /api/v1/infer/menu — エラー写像・枠', () => {
  it('上流の利用枠切れは AI_QUOTA_EXCEEDED', async () => {
    setMenuProviderForTesting({
      arrange: async () => {
        throw new MenuArrangeQuotaError('quota');
      },
    });
    const res = await post({ candidates: [candidate('a')], pantry: [], days: 1 });
    const json = (await res.json()) as MenuResult;

    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('AI_QUOTA_EXCEEDED');
      expect(json.error.retryable).toBe(false);
    }
  });

  it('月次無料枠を使い切ると FREE_QUOTA_EXCEEDED', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    setMenuProviderForTesting(stub(() => ({ days: [{ day: 1, recipeId: 'a', why: 'x' }] })));

    const first = (await (
      await post({ candidates: [candidate('a')], pantry: [], days: 1 })
    ).json()) as MenuResult;
    expect(first.ok).toBe(true);

    const second = (await (
      await post({ candidates: [candidate('a')], pantry: [], days: 1 })
    ).json()) as MenuResult;
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('FREE_QUOTA_EXCEEDED');
      expect(second.error.retryable).toBe(false);
    }
  });

  it('INFER_GLOBAL_DAILY_LIMIT=1 で 2 回目は RATE_LIMITED（プールは共有）', async () => {
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '1';
    setMenuProviderForTesting(stub(() => ({ days: [{ day: 1, recipeId: 'a', why: 'x' }] })));

    const first = (await (
      await post({ candidates: [candidate('a')], pantry: [], days: 1 })
    ).json()) as MenuResult;
    expect(first.ok).toBe(true);

    const second = (await (
      await post({ candidates: [candidate('a')], pantry: [], days: 1 })
    ).json()) as MenuResult;
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('RATE_LIMITED');
  });

  it('月次枠切れの連打は共有プールを消費しない（チェック順の固定）', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '3';
    setMenuProviderForTesting(stub(() => ({ days: [{ day: 1, recipeId: 'a', why: 'x' }] })));

    // 1 回目で無料枠を使い切る（共有プールを 1 消費）
    const first = (await (
      await post({ candidates: [candidate('a')], pantry: [], days: 1 })
    ).json()) as MenuResult;
    expect(first.ok).toBe(true);

    // 枠切れの状態で 5 回連打しても、共有プールは減らないはず
    for (let i = 0; i < 5; i += 1) {
      const res = (await (
        await post({ candidates: [candidate('a')], pantry: [], days: 1 })
      ).json()) as MenuResult;
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('FREE_QUOTA_EXCEEDED');
    }

    // token で月次枠を飛ばすと、共有プールは 3 のうち 1 しか使われていないので、
    // あと 2 回は通り、3 回目で尽きる
    const token1 = (await (
      await post(
        { candidates: [candidate('a')], pantry: [], days: 1 },
        { 'x-quota-source': 'token' },
      )
    ).json()) as MenuResult;
    expect(token1.ok).toBe(true);

    const token2 = (await (
      await post(
        { candidates: [candidate('a')], pantry: [], days: 1 },
        { 'x-quota-source': 'token' },
      )
    ).json()) as MenuResult;
    expect(token2.ok).toBe(true);

    const token3 = (await (
      await post(
        { candidates: [candidate('a')], pantry: [], days: 1 },
        { 'x-quota-source': 'token' },
      )
    ).json()) as MenuResult;
    expect(token3.ok).toBe(false);
    if (!token3.ok) expect(token3.error.code).toBe('RATE_LIMITED');
  });

  it('x-quota-source: token は月次枠チェックを飛ばす', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    setMenuProviderForTesting(stub(() => ({ days: [{ day: 1, recipeId: 'a', why: 'x' }] })));

    await post({ candidates: [candidate('a')], pantry: [], days: 1 }); // 枠を使い切る
    const exceeded = (await (
      await post({ candidates: [candidate('a')], pantry: [], days: 1 })
    ).json()) as MenuResult;
    expect(exceeded.ok).toBe(false);

    const viaToken = (await (
      await post(
        { candidates: [candidate('a')], pantry: [], days: 1 },
        { 'x-quota-source': 'token' },
      )
    ).json()) as MenuResult;
    expect(viaToken.ok).toBe(true);
  });

  it('x-quota-source: premium も同様に月次枠チェックを飛ばす', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    setMenuProviderForTesting(stub(() => ({ days: [{ day: 1, recipeId: 'a', why: 'x' }] })));

    await post({ candidates: [candidate('a')], pantry: [], days: 1 }); // 枠を使い切る
    const viaPremium = (await (
      await post(
        { candidates: [candidate('a')], pantry: [], days: 1 },
        { 'x-quota-source': 'premium' },
      )
    ).json()) as MenuResult;
    expect(viaPremium.ok).toBe(true);
  });

  it('未知の x-quota-source は無視して通常判定に落ちる', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    setMenuProviderForTesting(stub(() => ({ days: [{ day: 1, recipeId: 'a', why: 'x' }] })));

    await post({ candidates: [candidate('a')], pantry: [], days: 1 }); // 枠を使い切る
    const res = (await (
      await post(
        { candidates: [candidate('a')], pantry: [], days: 1 },
        { 'x-quota-source': 'bogus' },
      )
    ).json()) as MenuResult;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('FREE_QUOTA_EXCEEDED');
  });
});

describe('POST /api/v1/infer/menu — 入力', () => {
  it('x-device-id が無い/書式違反なら受け付けない', async () => {
    setMenuProviderForTesting(stub(() => ({ days: [{ day: 1, recipeId: 'a', why: 'x' }] })));
    const res = await app.request('/api/v1/infer/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // x-device-id 無し
      body: JSON.stringify({ candidates: [candidate('a')], pantry: [], days: 1 }),
    });
    const json = (await res.json()) as MenuResult;
    expect(json.ok).toBe(false);
  });

  it('候補が空の配列は 400（zod）', async () => {
    const res = await post({ candidates: [], pantry: [], days: 1 });
    expect(res.status).toBe(400);
  });
});

describe('コンテキストの組み立て', () => {
  it('候補は id 転記ミスを防ぐため JSON のまま渡す', () => {
    const text = buildMenuContext({
      candidates: [candidate('a')],
      pantry: [],
      days: 3,
    });
    expect(text).toContain(JSON.stringify([candidate('a')]));
    expect(text).toContain('## 日数');
    expect(text).toContain('3');
  });

  it('在庫・直近の料理が無ければ「無い」ことを明示する', () => {
    const text = buildMenuContext({ candidates: [], pantry: [], days: 1 });
    expect(text).toContain('（在庫は空）');
    expect(text).toContain('（記録なし）');
  });

  it('days は必須。note は「無いのが普通」なので必須にしない', () => {
    const schema = buildMenuResponseSchema();
    expect(schema.required).toContain('days');
    expect(schema.required).not.toContain('note');
  });
});
