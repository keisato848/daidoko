import { isInStock, itemNamesMatch } from '../itemMatch';
import { normalizeItemName } from '../itemName';

describe('itemMatch', () => {
  it('matches identical normalized names', () => {
    expect(itemNamesMatch('玉ねぎ', '玉ねぎ')).toBe(true);
    expect(itemNamesMatch('ニンジン', 'にんじん')).toBe(true); // katakana↔hiragana via normalize
  });

  it('matches a generic ingredient inside a longer product name (substring)', () => {
    expect(itemNamesMatch('しめじ', 'ぶなしめじ')).toBe(true);
    expect(itemNamesMatch('ごぼう', '洗いごぼう')).toBe(true);
    expect(itemNamesMatch('小麦粉', '春よ恋強力小麦粉')).toBe(true);
  });

  it('does not match unrelated names or short homophones', () => {
    expect(itemNamesMatch('牛乳', 'レタス')).toBe(false);
    expect(itemNamesMatch('塩', 'しおこんぶ')).toBe(false); // too short to substring
  });

  it('uses an optional alias map (kanji↔reading, product↔generic)', () => {
    const aliases = { [normalizeItemName('卵')]: normalizeItemName('たまご') };
    expect(itemNamesMatch('卵', 'たまご', aliases)).toBe(true); // canonical equal
    expect(itemNamesMatch('卵', 'とっとごたまご', aliases)).toBe(true); // 卵→たまご ⊂ とっとごたまご
    expect(itemNamesMatch('卵', 'たまご')).toBe(false); // without the map: no match
  });

  it('isInStock checks an ingredient against a pantry name list', () => {
    expect(isInStock('しめじ', ['ぶなしめじ', 'れたす'])).toBe(true);
    expect(isInStock('牛乳', ['ぶなしめじ', 'れたす'])).toBe(false);
  });
});
