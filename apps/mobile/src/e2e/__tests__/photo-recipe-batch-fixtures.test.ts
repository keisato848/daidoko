import { PHOTO_RECIPE_BATCH_FIXTURES } from '../photo-recipe-batch-fixtures';

describe('IMG-RECIPE-E2E-04 photo recipe batch fixtures', () => {
  it('contains at least 100 generated fixtures with unique ids', () => {
    expect(PHOTO_RECIPE_BATCH_FIXTURES).toHaveLength(100);
    expect(new Set(PHOTO_RECIPE_BATCH_FIXTURES.map((fixture) => fixture.id)).size).toBe(100);
    expect(PHOTO_RECIPE_BATCH_FIXTURES.every((fixture) => fixture.image > 0)).toBe(true);
  });
});