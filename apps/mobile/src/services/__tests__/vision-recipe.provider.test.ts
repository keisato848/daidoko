import { normalizeGeminiRaw } from '../vision-recipe.provider';

describe('normalizeGeminiRaw', () => {
  it('maps a full raw result, dropping empty entries', () => {
    const draft = normalizeGeminiRaw({
      isDish: true,
      title: 'カレー',
      ingredients: [{ name: '玉ねぎ', amount: '1個' }, { name: '' }],
      steps: [{ body: '炒める' }, { body: '  ' }],
      tags: ['和食', '', 'カレー'],
      confidence: 'high',
      servings: 2,
      cookTimeMin: 30,
    });
    expect(draft?.title).toBe('カレー');
    expect(draft?.ingredients).toHaveLength(1);
    expect(draft?.steps).toHaveLength(1);
    expect(draft?.tags).toEqual(['和食', 'カレー']);
    expect(draft?.confidence).toBe('high');
    expect(draft?.servings).toBe(2);
  });

  it('returns null when title/ingredients/steps are insufficient', () => {
    expect(normalizeGeminiRaw({ isDish: true, title: '', ingredients: [], steps: [] })).toBeNull();
    expect(
      normalizeGeminiRaw({ isDish: true, title: 'X', ingredients: [{ name: 'a' }], steps: [] }),
    ).toBeNull();
  });

  it('defaults invalid confidence to low and drops out-of-range servings', () => {
    const draft = normalizeGeminiRaw({
      isDish: true,
      title: 'X',
      ingredients: [{ name: 'a' }],
      steps: [{ body: 'b' }],
      servings: 999,
      confidence: 'bogus' as never,
    });
    expect(draft?.confidence).toBe('low');
    expect(draft?.servings).toBeUndefined();
  });
});
