import { AI_GENERATED_PHOTO_PREFIX, isAiGeneratedPhoto } from '../aiGeneratedPhoto';

describe('isAiGeneratedPhoto', () => {
  it('true for a relative stored path with the aigen- prefix', () => {
    expect(isAiGeneratedPhoto('recipe-photos/aigen-recipe-photo-20260829-abc.jpg')).toBe(true);
  });

  it('true for a resolved absolute uri with the aigen- prefix', () => {
    expect(
      isAiGeneratedPhoto('file:///documents/recipe-photos/aigen-recipe-photo-20260829-abc.jpg'),
    ).toBe(true);
  });

  it('false for a normal (human-picked) recipe photo', () => {
    expect(isAiGeneratedPhoto('recipe-photos/recipe-photo-20260829-abc.jpg')).toBe(false);
  });

  it('false when the prefix appears mid-name, not at the start of the basename', () => {
    expect(isAiGeneratedPhoto('recipe-photos/not-aigen-recipe-photo.jpg')).toBe(false);
  });

  it('false for null/undefined/empty', () => {
    expect(isAiGeneratedPhoto(null)).toBe(false);
    expect(isAiGeneratedPhoto(undefined)).toBe(false);
    expect(isAiGeneratedPhoto('')).toBe(false);
  });

  it('ignores a query string or fragment when checking the basename', () => {
    expect(isAiGeneratedPhoto('recipe-photos/aigen-x.jpg?ts=1')).toBe(true);
  });

  it('exposes the prefix constant used by persistRecipePhoto callers', () => {
    expect(AI_GENERATED_PHOTO_PREFIX).toBe('aigen-');
  });
});
