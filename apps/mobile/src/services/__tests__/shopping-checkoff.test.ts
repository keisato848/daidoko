/**
 * レシート消し込み（v13）。web では no-op であること、および
 * 「買った品が空なら何もしない」ことを固定する。
 *
 * 消し込みの方針（docs/買い物リスト・在庫設計.md）:
 * - **消さずにチェックを付ける**（誤照合で消えると気づけない）
 * - **照合は品目名だけ**。店は表示の絞り込み専用（同じ品を別の店で買うことがある）
 */
jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
}));

import { checkOffByNames } from '../shopping-list.service';

describe('checkOffByNames（web / 非ネイティブ）', () => {
  it('web では何もしない', async () => {
    expect(await checkOffByNames(['牛乳'])).toEqual({ count: 0, names: [] });
  });

  it('買った品が空なら DB を触らない', async () => {
    expect(await checkOffByNames([])).toEqual({ count: 0, names: [] });
  });
});
