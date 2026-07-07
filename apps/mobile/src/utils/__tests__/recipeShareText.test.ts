import type { RecipeDetail } from '../../services/types';
import { parseRecipeText } from '../recipeTextParser';
import { formatRecipeShareText } from '../recipeShareText';

function detail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    id: 'recipe-1',
    title: '肉じゃが',
    servings: 2,
    cookTimeMin: 30,
    description: '冷めても美味しい。翌日はカレーに。',
    rating: null,
    tags: ['和食'],
    ingredients: [
      { id: 'i1', groupLabel: null, name: 'じゃがいも', amount: '3個', note: null, sortOrder: 1 },
      { id: 'i2', groupLabel: null, name: '牛こま肉', amount: '200g', note: null, sortOrder: 2 },
      { id: 'i3', groupLabel: null, name: '玉ねぎ', amount: '1個', note: 'くし切り', sortOrder: 3 },
    ],
    steps: [
      { id: 's1', body: '材料を切る', timerSec: null, sortOrder: 1, photoPath: null },
      { id: 's2', body: '煮込む', timerSec: 600, sortOrder: 2, photoPath: null },
    ],
    heroPhotoUri: null,
    coverPhotoPath: null,
    pinnedAt: null,
    ...overrides,
  };
}

describe('formatRecipeShareText', () => {
  it('produces the expected text layout', () => {
    const text = formatRecipeShareText(detail());
    expect(text).toBe(
      [
        '肉じゃが',
        '2人分',
        '調理時間 30分',
        '',
        '材料',
        'じゃがいも 3個',
        '牛こま肉 200g',
        '玉ねぎ 1個（くし切り）',
        '',
        '作り方',
        '1. 材料を切る',
        '2. 煮込む',
        '',
        'メモ',
        '冷めても美味しい。翌日はカレーに。',
      ].join('\n'),
    );
  });

  it('round-trips through parseRecipeText (recipe exchange)', () => {
    const text = formatRecipeShareText(detail());
    const parsed = parseRecipeText(text);

    expect(parsed.formData.title).toBe('肉じゃが');
    expect(parsed.formData.servings).toBe(2);
    expect(parsed.formData.cookTimeMin).toBe(30);
    expect(parsed.formData.ingredients.map((i) => i.name)).toEqual([
      'じゃがいも',
      '牛こま肉',
      '玉ねぎ',
    ]);
    expect(parsed.formData.ingredients[0].amount).toBe('3個');
    expect(parsed.formData.steps.map((s) => s.body)).toEqual(['材料を切る', '煮込む']);
    expect(parsed.formData.description).toContain('冷めても美味しい');
    expect(parsed.confidence).toBe('high');
  });

  it('omits empty sections', () => {
    const text = formatRecipeShareText(
      detail({ servings: null, cookTimeMin: null, description: null, steps: [] }),
    );
    expect(text).not.toContain('人分');
    expect(text).not.toContain('調理時間');
    expect(text).not.toContain('作り方');
    expect(text).not.toContain('メモ');
  });

  it('inlines group labels into the ingredient name', () => {
    const text = formatRecipeShareText(
      detail({
        ingredients: [
          {
            id: 'i1',
            groupLabel: '下味',
            name: 'しょうゆ',
            amount: '大さじ1',
            note: null,
            sortOrder: 1,
          },
        ],
      }),
    );
    expect(text).toContain('【下味】しょうゆ 大さじ1');
  });
});
