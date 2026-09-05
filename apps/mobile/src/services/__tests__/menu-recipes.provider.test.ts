/**
 * 不足分レシピの一括生成（M3）— クライアント側。
 *
 * ここで固定するのは 2 点:
 * - `validateMenuRecipeDrafts`（サーバー `sanitizeMenuRecipeDrafts` の写し）のケース表
 * - サーバー経路が **`x-device-id` を必ず送ること**と `x-quota-source` の出し分け、
 *   1 操作 = fetch 1 回（M3-3「一括 = 1 回」の原価根拠をクライアント側でも固定する）
 */
const mockGetUserApiKey = jest.fn<Promise<string | null>, []>();
jest.mock('../byok.service', () => ({ getUserApiKey: () => mockGetUserApiKey() }));

const mockGetInstallationId = jest.fn<Promise<string>, []>();
jest.mock('../app-meta.service', () => ({ getInstallationId: () => mockGetInstallationId() }));

const mockResolveQuotaSource = jest.fn<Promise<'token' | 'premium' | undefined>, []>();
jest.mock('../usage.service', () => ({ resolveQuotaSource: () => mockResolveQuotaSource() }));

import {
  buildMenuRecipesSystemPrompt,
  generateMenuRecipes,
  MenuRecipesError,
  validateMenuRecipeDrafts,
  type MenuRecipesArgs,
} from '../menu-recipes.provider';

function rawDraft(title: string) {
  return {
    title,
    description: '平日向けの一品',
    ingredients: [{ name: '鶏むね肉', amount: '1枚' }],
    steps: [{ body: '焼く' }],
  };
}

describe('buildMenuRecipesSystemPrompt — 時間帯の出し分け（サーバーの写し・BYOK 経路用）', () => {
  it('省略・夕は従来のプロンプトのまま（朝/昼の指示が混ざらない）', () => {
    const dinner = buildMenuRecipesSystemPrompt('dinner');
    expect(buildMenuRecipesSystemPrompt()).toBe(dinner);
    expect(dinner).toContain('夕食を考える');
    expect(dinner).not.toContain('主食中心');
    expect(dinner).not.toContain('軽め');
  });

  it('朝は手早く作れる主食中心・昼は軽めの指示が入る', () => {
    expect(buildMenuRecipesSystemPrompt('breakfast')).toContain('主食中心');
    expect(buildMenuRecipesSystemPrompt('lunch')).toContain('軽め');
  });
});

describe('validateMenuRecipeDrafts — サーバー sanitizeMenuRecipeDrafts の写し', () => {
  it('材料か手順が空の品は捨てる（半端な下書きは保存できない）', () => {
    const result = validateMenuRecipeDrafts(
      {
        recipes: [
          { title: '材料なし', ingredients: [], steps: [{ body: '焼く' }] },
          { title: '手順なし', ingredients: [{ name: '卵' }], steps: [] },
          rawDraft('生き残る一品'),
        ],
      },
      [],
      3,
    );
    expect(result.map((r) => r.title)).toEqual(['生き残る一品']);
  });

  it('手持ちレシピと同名（空白・大小の差を無視）の品は捨てる', () => {
    const result = validateMenuRecipeDrafts(
      { recipes: [rawDraft('肉じゃが'), rawDraft('新しい一品')] },
      ['肉 じゃが'],
      2,
    );
    expect(result.map((r) => r.title)).toEqual(['新しい一品']);
  });

  it('生成結果同士の同名は 2 品目以降を捨てる', () => {
    const result = validateMenuRecipeDrafts(
      { recipes: [rawDraft('カレー'), rawDraft('カレー'), rawDraft('シチュー')] },
      [],
      3,
    );
    expect(result.map((r) => r.title)).toEqual(['カレー', 'シチュー']);
  });

  it('days を超えて返っても先頭から days 品だけ', () => {
    const result = validateMenuRecipeDrafts(
      { recipes: [rawDraft('一品目'), rawDraft('二品目'), rawDraft('三品目')] },
      [],
      2,
    );
    expect(result).toHaveLength(2);
  });

  it('"null"/"undefined" という文字列のフィールドは空として扱う', () => {
    const result = validateMenuRecipeDrafts(
      {
        recipes: [
          {
            title: '一品',
            description: 'null',
            ingredients: [{ name: '卵', amount: 'undefined' }],
            steps: [{ body: '焼く' }],
          },
        ],
      },
      [],
      1,
    );
    expect(result[0]).not.toHaveProperty('description');
    expect(result[0]?.ingredients[0]).not.toHaveProperty('amount');
  });

  it('raw が null/undefined でも落ちない（空扱い）', () => {
    expect(validateMenuRecipeDrafts(null, [], 3)).toEqual([]);
    expect(validateMenuRecipeDrafts(undefined, [], 3)).toEqual([]);
  });
});

describe('generateMenuRecipes — managed サーバー経由', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  const args: MenuRecipesArgs = {
    days: 2,
    existingTitles: ['肉じゃが'],
    pantry: ['卵'],
    preferences: '義母は洋食を食べない',
  };

  beforeEach(() => {
    mockGetUserApiKey.mockReset().mockResolvedValue(null);
    mockGetInstallationId.mockReset().mockResolvedValue('device-abc-123');
    mockResolveQuotaSource.mockReset().mockResolvedValue(undefined);
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, data: { recipes: [rawDraft('一品'), rawDraft('二品')] } }),
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

  it('1 操作 = fetch 1 回（品数分呼ばない・M3-3）', async () => {
    const result = await generateMenuRecipes({ ...args, days: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.length).toBeGreaterThan(0);
  });

  it('x-device-id を必ず送る（付け忘れるとサーバーが即 ok:false を返す）', async () => {
    await generateMenuRecipes(args);
    expect(lastHeaders()['x-device-id']).toBe('device-abc-123');
  });

  it('無料枠の範囲内では x-quota-source を送らない', async () => {
    await generateMenuRecipes(args);
    expect(lastHeaders()['x-quota-source']).toBeUndefined();
  });

  it('トークン消費のときは x-quota-source: token を送る', async () => {
    mockResolveQuotaSource.mockResolvedValue('token');
    await generateMenuRecipes(args);
    expect(lastHeaders()['x-quota-source']).toBe('token');
  });

  it('プレミアムのときは x-quota-source: premium を送る', async () => {
    mockResolveQuotaSource.mockResolvedValue('premium');
    await generateMenuRecipes(args);
    expect(lastHeaders()['x-quota-source']).toBe('premium');
  });

  it('days・手持ち・在庫・嗜好メモ・locale・unitSystem を送る', async () => {
    await generateMenuRecipes(args);
    const body = lastBody();
    expect(body['days']).toBe(2);
    expect(body['existingTitles']).toEqual(['肉じゃが']);
    expect(body['pantry']).toEqual(['卵']);
    expect(body['preferences']).toBe('義母は洋食を食べない');
    expect(body['locale']).toBeDefined();
    expect(body['unitSystem']).toBeDefined();
  });

  it('嗜好メモが空なら preferences を載せない', async () => {
    await generateMenuRecipes({ ...args, preferences: '   ' });
    expect(lastBody()).not.toHaveProperty('preferences');
  });

  it('mealTime を指定すると送る（§10.13）', async () => {
    await generateMenuRecipes({ ...args, mealTime: 'lunch' });
    expect(lastBody()['mealTime']).toBe('lunch');
  });

  it('mealTime 省略時は載せない（旧クライアントと同じリクエスト形 = サーバー既定の夕）', async () => {
    await generateMenuRecipes(args);
    expect(lastBody()).not.toHaveProperty('mealTime');
  });

  it('手持ち 31 件・在庫 51 件は上限へ切り詰めて送る', async () => {
    await generateMenuRecipes({
      days: 1,
      existingTitles: Array.from({ length: 40 }, (_, i) => `t${i}`),
      pantry: Array.from({ length: 60 }, (_, i) => `p${i}`),
    });
    const body = lastBody() as { existingTitles: unknown[]; pantry: unknown[] };
    expect(body.existingTitles).toHaveLength(30);
    expect(body.pantry).toHaveLength(50);
  });

  it('managed 応答にも防御的に検証を通す（手持ちと同名は落ちる）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { recipes: [rawDraft('肉じゃが')] } }),
    });
    const result = await generateMenuRecipes(args);
    expect(result).toEqual([]);
  });

  it('/infer/menu-recipes 未デプロイの 404 も MenuRecipesError にする', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(generateMenuRecipes(args)).rejects.toBeInstanceOf(MenuRecipesError);
  });

  it('FREE_QUOTA_EXCEEDED は retryable=false で失敗する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: { code: 'FREE_QUOTA_EXCEEDED', message: 'x', retryable: false },
      }),
    });
    await expect(generateMenuRecipes(args)).rejects.toMatchObject({ retryable: false });
  });

  it('BYOK があるときはサーバーを叩かない', async () => {
    mockGetUserApiKey.mockResolvedValue('user-key');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ recipes: [rawDraft('一品')] }) }],
            },
          },
        ],
      }),
    });

    const result = await generateMenuRecipes(args);

    expect(result.map((r) => r.title)).toEqual(['一品']);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(mockGetInstallationId).not.toHaveBeenCalled();
  });
});
