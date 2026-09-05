import { normalizeMealRaw } from '../meal-vision.provider';

describe('normalizeMealRaw', () => {
  it('keeps named ingredients (trimmed), drops empty, maps amount', () => {
    const r = normalizeMealRaw({
      isMeal: true,
      dish: ' オムライス ',
      ingredients: [
        { name: ' 卵 ' },
        { name: '' },
        { amount: '1' },
        { name: 'ご飯', amount: ' 1杯 ' },
      ],
    });
    expect(r.isMeal).toBe(true);
    expect(r.dish).toBe('オムライス');
    expect(r.ingredients).toEqual([
      { name: '卵', amount: null },
      { name: 'ご飯', amount: '1杯' },
    ]);
  });

  it('returns empty when not a meal', () => {
    expect(normalizeMealRaw({ isMeal: false })).toEqual({
      isMeal: false,
      dish: null,
      ingredients: [],
    });
  });
});

describe('normalizeMealRaw — 語彙防御（水平展開規約②・サーバー sanitizeMealRaw と対）', () => {
  it('カテゴリ語の材料は除外する（具体名は残す）', () => {
    const r = normalizeMealRaw({
      isMeal: true,
      dish: '肉じゃが',
      ingredients: [{ name: 'じゃがいも' }, { name: '調味料' }, { name: '牛肉' }],
    });
    expect(r.ingredients.map((i) => i.name)).toEqual(['じゃがいも', '牛肉']);
  });
});
