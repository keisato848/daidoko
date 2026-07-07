import { recipeMatchesQuery } from '../recipeSearch';

function recipe(overrides: Partial<Parameters<typeof recipeMatchesQuery>[0]> = {}) {
  return {
    title: '肉じゃが',
    titleReading: 'にくじゃが',
    tags: ['和食', '定番'],
    ingredientNames: ['じゃがいも', '牛肉', 'タマネギ'],
    ...overrides,
  };
}

describe('recipeMatchesQuery', () => {
  it('matches exact title substring', () => {
    expect(recipeMatchesQuery(recipe(), '肉じゃが')).toBe(true);
    expect(recipeMatchesQuery(recipe(), 'じゃが')).toBe(true);
  });

  it('empty query matches everything', () => {
    expect(recipeMatchesQuery(recipe(), '')).toBe(true);
    expect(recipeMatchesQuery(recipe(), '   ')).toBe(true);
  });

  it('does not match unrelated query', () => {
    expect(recipeMatchesQuery(recipe(), 'カレー')).toBe(false);
  });

  it('bridges katakana and hiragana both ways', () => {
    // 登録はカタカナ「タマネギ」、検索はひらがな
    expect(recipeMatchesQuery(recipe(), 'たまねぎ')).toBe(true);
    // 登録はひらがな「じゃがいも」、検索はカタカナ
    expect(recipeMatchesQuery(recipe(), 'ジャガイモ')).toBe(true);
  });

  it('matches title by reading (kana input finds kanji title)', () => {
    expect(recipeMatchesQuery(recipe(), 'にくじゃが')).toBe(true);
    expect(recipeMatchesQuery(recipe(), 'ニクジャガ')).toBe(true);
  });

  it('normalizes full-width / half-width and case', () => {
    const r = recipe({ title: 'BBQチキン', titleReading: null, ingredientNames: ['ﾋﾟｰﾏﾝ'] });
    expect(recipeMatchesQuery(r, 'ｂｂｑ')).toBe(true);
    expect(recipeMatchesQuery(r, 'ピーマン')).toBe(true);
    expect(recipeMatchesQuery(r, 'ぴーまん')).toBe(true);
  });

  it('matches tags with normalization', () => {
    expect(recipeMatchesQuery(recipe({ tags: ['ワショク'] }), 'わしょく')).toBe(true);
  });

  it('bridges kanji⇄reading via the alias map (query side)', () => {
    const r = recipe({ ingredientNames: ['卵'] });
    // 名寄せキャッシュ: たまご → 卵
    expect(recipeMatchesQuery(r, 'たまご', { たまご: '卵' })).toBe(true);
    expect(recipeMatchesQuery(r, 'タマゴ', { たまご: '卵' })).toBe(true);
    // キャッシュが空なら漢字⇄かなは越えられない（劣化のみ・誤爆なし）
    expect(recipeMatchesQuery(r, 'たまご', {})).toBe(false);
  });

  it('bridges product name → canonical via the alias map (ingredient side)', () => {
    const r = recipe({ ingredientNames: ['とっとごたまご'] });
    expect(recipeMatchesQuery(r, '卵', { とっとごたまご: '卵' })).toBe(true);
  });

  it('handles null reading and empty fields', () => {
    const r = recipe({ titleReading: null, tags: [], ingredientNames: [] });
    expect(recipeMatchesQuery(r, '肉じゃが')).toBe(true);
    expect(recipeMatchesQuery(r, 'にくじゃが')).toBe(false);
  });
});
