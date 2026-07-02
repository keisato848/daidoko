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
