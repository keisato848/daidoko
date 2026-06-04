import { inferRecipeFromPhotoLabels } from '../recipe-photo-inference.service';
import type { ClientImageLabel } from '../client-image-label.provider';

function label(text: string, confidence: number): ClientImageLabel {
  return { text, confidence };
}

describe('IMG-RECIPE-01 inferRecipeFromPhotoLabels', () => {
  it('creates an editable curry draft when a curry-like label is present', () => {
    const result = inferRecipeFromPhotoLabels([
      label('Food', 0.93),
      label('Curry', 0.82),
      label('Tableware', 0.7),
    ]);

    expect(result.draft.title).toBe('写真から推測したカレー');
    expect(result.confidence).toBe('medium');
    expect(result.draft.ingredients.map((ingredient) => ingredient.name)).toContain(
      'カレー粉またはルー',
    );
    expect(result.draft.steps).toHaveLength(3);
    expect(result.warnings[0]).toContain('写真だけでは');
  });

  it('falls back to a generic confirmation-first draft when the dish is unclear', () => {
    const result = inferRecipeFromPhotoLabels([label('Plate', 0.66), label('Food', 0.62)]);

    expect(result.draft.title).toBe('料理写真からのレシピ案');
    expect(result.confidence).toBe('low');
    expect(result.draft.ingredients[0].name).toContain('写真を見て確認');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('料理名を特定できなかった')]),
    );
  });

  it('returns a valid low-confidence draft even when labels are empty', () => {
    const result = inferRecipeFromPhotoLabels([]);

    expect(result.draft.title).toBeTruthy();
    expect(result.draft.ingredients.length).toBeGreaterThan(0);
    expect(result.draft.steps.length).toBeGreaterThan(0);
    expect(result.confidence).toBe('low');
  });
});
