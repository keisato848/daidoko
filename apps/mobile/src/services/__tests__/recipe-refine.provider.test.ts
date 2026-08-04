import { normalizeRefinedRaw, refineRecipe } from '../recipe-refine.provider';
import { VisionInferenceError, visionErrorMessage } from '../vision-recipe.provider';

jest.mock('../byok.service', () => ({ getUserApiKey: jest.fn(async () => null) }));

const BASE = {
  title: '麻婆豆腐',
  servings: 2,
  cookTimeMin: 25,
  ingredients: [
    { name: '木綿豆腐', amount: '1丁' },
    { name: '甜麺醤', amount: '大さじ2' },
  ],
  steps: [{ body: '豆腐を切る' }, { body: '煮る' }],
  tags: ['中華'],
};

describe('normalizeRefinedRaw', () => {
  it('省いたフィールドは現行レシピの値を残す（省略＝変更なし）', () => {
    const draft = normalizeRefinedRaw(
      {
        changed: true,
        ingredients: [
          { name: '木綿豆腐', amount: '1丁' },
          { name: '甜麺醤', amount: '大さじ1' },
        ],
        steps: [{ body: '豆腐を切る' }, { body: '煮る' }],
      },
      BASE,
    );

    expect(draft?.title).toBe('麻婆豆腐');
    expect(draft?.servings).toBe(2);
    expect(draft?.cookTimeMin).toBe(25);
    expect(draft?.tags).toEqual(['中華']);
  });

  it('材料・手順が全滅したら null（現行レシピで埋めて「直した」と偽らない）', () => {
    expect(normalizeRefinedRaw({ changed: true, ingredients: [], steps: [] }, BASE)).toBeNull();
    expect(
      normalizeRefinedRaw({ changed: true, ingredients: [{ name: 'a' }], steps: [] }, BASE),
    ).toBeNull();
  });

  it('空文字の材料名は落とす', () => {
    const draft = normalizeRefinedRaw(
      {
        changed: true,
        ingredients: [{ name: '豆腐', amount: '1丁' }, { name: '   ' }],
        steps: [{ body: '切る' }],
      },
      BASE,
    );
    expect(draft?.ingredients).toHaveLength(1);
  });
});

describe('refineRecipe（サーバー経路）', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockResponse(body: unknown, ok = true, status = 200): void {
    global.fetch = jest.fn(async () => ({
      ok,
      status,
      json: async () => body,
    })) as unknown as typeof fetch;
  }

  it('調整結果と changeSummary を返す', async () => {
    mockResponse({
      ok: true,
      data: {
        draft: {
          title: '麻婆豆腐',
          ingredients: [{ name: '甜麺醤', amount: '大さじ1' }],
          steps: [{ body: '煮る' }],
        },
        changeSummary: '甜麺醤を減らしました。',
      },
    });

    const result = await refineRecipe({ recipe: BASE, feedback: '甘すぎた' });

    expect(result.changeSummary).toBe('甜麺醤を減らしました。');
    expect(result.draft.ingredients[0]).toMatchObject({ name: '甜麺醤', amount: '大さじ1' });
  });

  it('REFINE_NO_CHANGE は no_change として扱い、書き方の案内をそのまま出す', async () => {
    mockResponse({
      ok: false,
      error: {
        code: 'REFINE_NO_CHANGE',
        message: '味の方向（甘い・辛い・濃いなど）が書かれていません。',
        retryable: false,
      },
    });

    await expect(refineRecipe({ recipe: BASE, feedback: 'おいしかった' })).rejects.toMatchObject({
      kind: 'no_change',
      message: '味の方向（甘い・辛い・濃いなど）が書かれていません。',
      retryable: false,
    });
  });

  it('枠切れは quota_exceeded（「つながらない」と混同しない）', async () => {
    mockResponse({
      ok: false,
      error: {
        code: 'AI_QUOTA_EXCEEDED',
        message: '本日の AI 利用上限に達しました。',
        retryable: false,
      },
    });

    await expect(refineRecipe({ recipe: BASE, feedback: '甘すぎた' })).rejects.toMatchObject({
      kind: 'quota_exceeded',
    });
  });

  it('通信できなければ offline（接続を促す）', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    await expect(refineRecipe({ recipe: BASE, feedback: '甘すぎた' })).rejects.toMatchObject({
      kind: 'offline',
    });
  });
});

describe('visionErrorMessage', () => {
  it('no_change は再試行ではなく「何を書けばよいか」を伝える', () => {
    const message = visionErrorMessage('no_change');
    expect(message).toContain('味の方向');
    expect(message).not.toContain('もう一度お試しください');
  });

  it('サーバーの理由があればそれを優先する', () => {
    expect(visionErrorMessage('no_change', 'レシピと関係のない内容でした。')).toBe(
      'レシピと関係のない内容でした。',
    );
  });
});

describe('VisionInferenceError', () => {
  it('kind の既定は failed', () => {
    expect(new VisionInferenceError('x', true).kind).toBe('failed');
  });
});
