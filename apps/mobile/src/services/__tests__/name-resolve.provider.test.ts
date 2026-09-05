/**
 * 名寄せの語彙防御（水平展開規約②・サーバー `lib/name-resolve.ts` と対）。
 * カテゴリ語へ丸め上げられた解決は空文字扱い — 誤った正規名は
 * `name_aliases` キャッシュに残って照合を壊し続けるため、入口で止める。
 */
jest.mock('../byok.service', () => ({ getUserApiKey: async () => null }));

import { parseResolved } from '../name-resolve.provider';

describe('parseResolved — カテゴリ語への丸め上げを空文字扱いにする', () => {
  it('canonical がカテゴリ語なら空文字（非食材と同じ扱い）', () => {
    expect(
      parseResolved([
        { name: 'とっとごたまご', canonical: '卵' },
        { name: '味覇', canonical: '調味料' },
        { name: 'ペットのお茶', canonical: 'Drinks' },
      ]),
    ).toEqual([
      { name: 'とっとごたまご', canonical: '卵' },
      { name: '味覇', canonical: '' },
      { name: 'ペットのお茶', canonical: '' },
    ]);
  });

  it('具体名・空文字（非食材）はそのまま通す', () => {
    expect(
      parseResolved([
        { name: 'レジ袋', canonical: '' },
        { name: 'ぶなしめじ', canonical: 'しめじ' },
      ]),
    ).toEqual([
      { name: 'レジ袋', canonical: '' },
      { name: 'ぶなしめじ', canonical: 'しめじ' },
    ]);
  });
});
