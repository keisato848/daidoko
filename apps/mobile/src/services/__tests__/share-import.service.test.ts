/**
 * 共有リンクをアプリで開く（#198）。
 *
 * 固定したいこと:
 * - リンクの形（/r/:slug・/b/:slug）から種別と slug を取り出せる。それ以外は null
 * - サーバーの応答を取り込み画面が扱える誤り種別に写す（404・パスコード・通信断）
 */
import {
  ShareImportError,
  fetchSharedBook,
  fetchSharedRecipe,
  parseShareLink,
} from '../share-import.service';

const originalFetch = global.fetch;

function mockFetch(status: number, body: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('parseShareLink', () => {
  it('レシピと帖のリンクを見分ける', () => {
    expect(parseShareLink('https://daidoko-production.up.railway.app/r/abc123XY')).toEqual({
      kind: 'recipe',
      slug: 'abc123XY',
    });
    expect(parseShareLink('https://daidoko-production.up.railway.app/b/book_9?x=1')).toEqual({
      kind: 'book',
      slug: 'book_9',
    });
  });

  it('共有リンクでなければ null', () => {
    expect(parseShareLink('https://example.com/recipes/1')).toBeNull();
    expect(parseShareLink('daidoko://shopping')).toBeNull();
  });
});

describe('fetchSharedRecipe / fetchSharedBook', () => {
  it('200 なら data を返す', async () => {
    mockFetch(200, {
      ok: true,
      data: { slug: 'a1b2c3', title: '卵かけご飯', ingredients: [], steps: [], tags: [] },
    });
    const recipe = await fetchSharedRecipe('a1b2c3');
    expect(recipe.title).toBe('卵かけご飯');
  });

  it('404 は NOT_FOUND（停止・期限切れも同じ）', async () => {
    mockFetch(404, { ok: false, error: 'NOT_FOUND' });
    await expect(fetchSharedRecipe('gone')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('パスコード付きの帖: 無ければ要求・違えば違う・多すぎればロック、をそのまま伝える', async () => {
    mockFetch(401, { ok: false, error: 'PASSCODE_REQUIRED' });
    await expect(fetchSharedBook('bk')).rejects.toMatchObject({ code: 'PASSCODE_REQUIRED' });

    const wrong = mockFetch(401, { ok: false, error: 'PASSCODE_WRONG' });
    await expect(fetchSharedBook('bk', '000000')).rejects.toMatchObject({ code: 'PASSCODE_WRONG' });
    // パスコードはヘッダで渡す（URL に載せない）
    expect((wrong.mock.calls[0] as unknown[])[1]).toEqual({
      headers: { 'x-share-passcode': '000000' },
    });

    mockFetch(429, { ok: false, error: 'PASSCODE_LOCKED' });
    await expect(fetchSharedBook('bk', '111111')).rejects.toMatchObject({
      code: 'PASSCODE_LOCKED',
    });
  });

  it('通信断は NETWORK、それ以外の失敗は SERVER', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(fetchSharedRecipe('x')).rejects.toBeInstanceOf(ShareImportError);
    await expect(fetchSharedRecipe('x')).rejects.toMatchObject({ code: 'NETWORK' });

    mockFetch(502, null);
    await expect(fetchSharedRecipe('x')).rejects.toMatchObject({ code: 'SERVER' });
  });
});
