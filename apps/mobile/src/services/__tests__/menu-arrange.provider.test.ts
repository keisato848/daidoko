/**
 * AI 献立並べ替え（M2）— クライアント側。
 *
 * ここで固定するのは 2 点:
 * - `validateArrangement`（サーバー `sanitizeMenuDays` の写し）のケース表（設計 §10.10.3）
 * - サーバー経路が **`x-device-id` を必ず送ること**（付け忘れると AI 経路が永久に
 *   無言で M1 へ落ち、誰も気づけない）と、`x-quota-source` の出し分け（§10.10.7-2）
 */
const mockGetUserApiKey = jest.fn<Promise<string | null>, []>();
jest.mock('../byok.service', () => ({ getUserApiKey: () => mockGetUserApiKey() }));

const mockGetInstallationId = jest.fn<Promise<string>, []>();
jest.mock('../app-meta.service', () => ({ getInstallationId: () => mockGetInstallationId() }));

const mockResolveQuotaSource = jest.fn<Promise<'token' | 'premium' | undefined>, []>();
jest.mock('../usage.service', () => ({ resolveQuotaSource: () => mockResolveQuotaSource() }));

import {
  arrangeMenu,
  MAX_ARRANGE_CANDIDATES,
  MenuArrangeError,
  validateArrangement,
  type MenuArrangeInput,
} from '../menu-arrange.provider';

const CANDIDATE_IDS = new Set(['r1', 'r2', 'r3']);

describe('validateArrangement — サーバー sanitizeMenuDays の写し（§10.10.3）', () => {
  it('渡していない recipeId → 落ちる', () => {
    const result = validateArrangement(
      {
        days: [
          { day: 1, recipeId: 'r1', why: 'a' },
          { day: 2, recipeId: 'unknown', why: 'b' },
        ],
      },
      CANDIDATE_IDS,
      7,
    );
    expect(result.days).toEqual([{ day: 1, recipeId: 'r1', why: 'a' }]);
  });

  it('day 重複 → 先勝ち', () => {
    const result = validateArrangement(
      {
        days: [
          { day: 1, recipeId: 'r1', why: 'first' },
          { day: 1, recipeId: 'r2', why: 'second' },
        ],
      },
      CANDIDATE_IDS,
      7,
    );
    expect(result.days).toEqual([{ day: 1, recipeId: 'r1', why: 'first' }]);
  });

  it.each([0, 9, 1.5])('day=%s（1..7 の整数でない） → 落ちる', (day) => {
    const result = validateArrangement(
      { days: [{ day, recipeId: 'r1', why: 'x' }] },
      CANDIDATE_IDS,
      7,
    );
    expect(result.days).toEqual([]);
  });

  it('同一 recipeId の 2 日目以降 → 後落ち（M1 の「1 レシピ 1 日」を AI 出力にも通す）', () => {
    const result = validateArrangement(
      {
        days: [
          { day: 1, recipeId: 'r1', why: 'first' },
          { day: 2, recipeId: 'r1', why: 'second' },
        ],
      },
      CANDIDATE_IDS,
      7,
    );
    expect(result.days).toEqual([{ day: 1, recipeId: 'r1', why: 'first' }]);
  });

  it('X=7 に対して有効な行が 3 件 → 3 日のまま（埋めない）', () => {
    const result = validateArrangement(
      {
        days: [
          { day: 1, recipeId: 'r1', why: 'a' },
          { day: 2, recipeId: 'r2', why: 'b' },
          { day: 3, recipeId: 'r3', why: 'c' },
        ],
      },
      CANDIDATE_IDS,
      7,
    );
    expect(result.days).toHaveLength(3);
  });

  it('全滅 → 空配列（呼び出し側が MENU_ARRANGE_FAILED/emptyResult 扱いにする）', () => {
    const result = validateArrangement(
      { days: [{ day: 100, recipeId: 'nope', why: 'x' }] },
      CANDIDATE_IDS,
      7,
    );
    expect(result.days).toEqual([]);
  });

  it('day 昇順に整列する（モデルの出力順に依存しない）', () => {
    const result = validateArrangement(
      {
        days: [
          { day: 3, recipeId: 'r3', why: 'c' },
          { day: 1, recipeId: 'r1', why: 'a' },
          { day: 2, recipeId: 'r2', why: 'b' },
        ],
      },
      CANDIDATE_IDS,
      7,
    );
    expect(result.days.map((d) => d.day)).toEqual([1, 2, 3]);
  });

  it('why は 100 字で切り、無ければ省略する', () => {
    const result = validateArrangement(
      {
        days: [
          { day: 1, recipeId: 'r1', why: 'あ'.repeat(150) },
          { day: 2, recipeId: 'r2' },
        ],
      },
      CANDIDATE_IDS,
      7,
    );
    expect(result.days[0]?.why).toHaveLength(100);
    expect(result.days[1]).not.toHaveProperty('why');
  });

  it('note はそのまま通す。空・未指定なら省略する', () => {
    expect(
      validateArrangement({ days: [], note: '  後半は買い足し前提  ' }, CANDIDATE_IDS, 7),
    ).toEqual({
      days: [],
      note: '後半は買い足し前提',
    });
    expect(validateArrangement({ days: [] }, CANDIDATE_IDS, 7)).toEqual({ days: [] });
  });

  it('raw が null/undefined でも落ちない（空扱い）', () => {
    expect(validateArrangement(null, CANDIDATE_IDS, 7)).toEqual({ days: [] });
    expect(validateArrangement(undefined, CANDIDATE_IDS, 7)).toEqual({ days: [] });
  });
});

describe('arrangeMenu — managed サーバー経由', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  const input: MenuArrangeInput = {
    candidates: [{ id: 'r1', title: 'カレー', coveragePct: 80, missing: [] }],
    pantry: ['卵'],
    days: 3,
  };

  beforeEach(() => {
    mockGetUserApiKey.mockReset().mockResolvedValue(null);
    mockGetInstallationId.mockReset().mockResolvedValue('device-abc-123');
    mockResolveQuotaSource.mockReset().mockResolvedValue(undefined);
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, data: { days: [{ day: 1, recipeId: 'r1', why: 'x' }] } }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function lastHeaders(): Record<string, string> {
    return (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
  }

  function lastBody(): Record<string, unknown> {
    const init = fetchMock.mock.calls[0][1] as { body: string };
    return JSON.parse(init.body) as Record<string, unknown>;
  }

  it('x-device-id を必ず送る（付け忘れると AI 経路が無言で M1 に落ちる・§10.10.3）', async () => {
    await arrangeMenu(input);
    expect(lastHeaders()['x-device-id']).toBe('device-abc-123');
  });

  it('無料枠の範囲内では x-quota-source を送らない（サーバー側の月次枠チェックに乗せる）', async () => {
    await arrangeMenu(input);
    expect(lastHeaders()['x-quota-source']).toBeUndefined();
  });

  it('トークン消費のときは x-quota-source: token を送る（§10.10.7-2）', async () => {
    mockResolveQuotaSource.mockResolvedValue('token');
    await arrangeMenu(input);
    expect(lastHeaders()['x-quota-source']).toBe('token');
  });

  it('プレミアムのときは x-quota-source: premium を送る', async () => {
    mockResolveQuotaSource.mockResolvedValue('premium');
    await arrangeMenu(input);
    expect(lastHeaders()['x-quota-source']).toBe('premium');
  });

  it('unitSystem は載せない（分量を出力しない推論への圧力になるだけ・§10.5）', async () => {
    await arrangeMenu(input);
    expect(lastBody()).not.toHaveProperty('unitSystem');
  });

  it('候補は MAX_ARRANGE_CANDIDATES 件に切り詰めて送る', async () => {
    const many: MenuArrangeInput = {
      candidates: Array.from({ length: MAX_ARRANGE_CANDIDATES + 10 }, (_, i) => ({
        id: `r${i}`,
        title: `t${i}`,
        coveragePct: 0,
        missing: [],
      })),
      pantry: [],
      days: 3,
    };
    await arrangeMenu(many);
    const body = lastBody() as { candidates: unknown[] };
    expect(body.candidates).toHaveLength(MAX_ARRANGE_CANDIDATES);
  });

  it('managed 応答にも防御的に検証を通す（渡していない recipeId は落ちる）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { days: [{ day: 1, recipeId: 'not-a-candidate' }] } }),
    });
    const result = await arrangeMenu(input);
    expect(result.days).toEqual([]);
  });

  it('/infer/menu 未デプロイの 404 も例外を握って MenuArrangeError にする（M1 へ落とす）', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(arrangeMenu(input)).rejects.toBeInstanceOf(MenuArrangeError);
  });

  it('FREE_QUOTA_EXCEEDED は待つしかない文言・retryable=false で失敗する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: { code: 'FREE_QUOTA_EXCEEDED', message: 'x', retryable: false },
      }),
    });
    await expect(arrangeMenu(input)).rejects.toMatchObject({ retryable: false });
  });

  it('BYOK があるときはサーバーを叩かない（device-id もヘッダも要らない）', async () => {
    mockGetUserApiKey.mockResolvedValue('user-key');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ days: [{ day: 1, recipeId: 'r1', why: 'x' }] }) }],
            },
          },
        ],
      }),
    });

    const result = await arrangeMenu(input);

    expect(result.days).toEqual([{ day: 1, recipeId: 'r1', why: 'x' }]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(mockGetInstallationId).not.toHaveBeenCalled();
  });
});
