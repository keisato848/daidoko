import {
  createLocalHeuristicRecipeTextNormalizer,
  parseRecipeTextWithAssistance,
  type RecipeTextNormalizerProvider,
} from '../recipeTextNormalizer';

describe('parseRecipeTextWithAssistance', () => {
  it('keeps high-confidence parser results without invoking providers', async () => {
    const provider: RecipeTextNormalizerProvider = {
      source: 'local-heuristic',
      isAvailable: jest.fn(async () => true),
      normalize: jest.fn(async () => ({
        ok: false,
        source: 'local-heuristic',
        reason: 'should not be called',
      })),
    };

    const result = await parseRecipeTextWithAssistance(
      `肉じゃが
材料
じゃがいも 3個
作り方
1. 煮る`,
      { providers: [provider] },
    );

    expect(result.confidence).toBe('high');
    expect(result.normalizedBy).toBe('parser');
    expect(provider.isAvailable).not.toHaveBeenCalled();
    expect(provider.normalize).not.toHaveBeenCalled();
  });

  it('uses local heuristics to normalize compact freeform recipe text', async () => {
    const result = await parseRecipeTextWithAssistance(
      '親子丼は鶏もも肉200gと玉ねぎ1/2個と卵2個。2人分、調理時間15分。鶏肉と玉ねぎを煮て、卵でとじる。',
      { providers: [createLocalHeuristicRecipeTextNormalizer()] },
    );

    expect(result.normalizedBy).toBe('local-heuristic');
    expect(result.confidence).toBe('high');
    expect(result.formData.title).toBe('親子丼');
    expect(result.formData.servings).toBe(2);
    expect(result.formData.cookTimeMin).toBe(15);
    expect(result.formData.ingredients.map((ingredient) => ingredient.name)).toEqual([
      '鶏もも肉',
      '玉ねぎ',
      '卵',
    ]);
    expect(result.formData.steps[0]?.body).toContain('卵でとじる');
  });

  it('falls back to the original parser result when providers cannot improve it', async () => {
    const provider: RecipeTextNormalizerProvider = {
      source: 'gemma-native',
      isAvailable: async () => true,
      normalize: async () => ({ ok: true, source: 'gemma-native', text: '名前だけ' }),
    };

    const result = await parseRecipeTextWithAssistance('名前だけ', { providers: [provider] });

    expect(result.normalizedBy).toBe('parser');
    expect(result.confidence).toBe('low');
    expect(result.warnings.join('\n')).toContain('normalized output did not improve');
  });
});
