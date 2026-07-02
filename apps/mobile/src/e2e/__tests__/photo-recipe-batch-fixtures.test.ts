import { PHOTO_RECIPE_BATCH_FIXTURES } from '../photo-recipe-batch-fixtures';

describe('IMG-RECIPE-E2E-04 photo recipe batch fixtures', () => {
  it('contains at least 100 generated fixtures with unique ids', () => {
    expect(PHOTO_RECIPE_BATCH_FIXTURES).toHaveLength(100);
    expect(new Set(PHOTO_RECIPE_BATCH_FIXTURES.map((fixture) => fixture.id)).size).toBe(100);
    // Each fixture references a bundled image asset. Under jest-expo's asset
    // mock the import resolves to a truthy placeholder (not necessarily a
    // numeric module id), so assert presence rather than a numeric value.
    expect(PHOTO_RECIPE_BATCH_FIXTURES.every((fixture) => Boolean(fixture.image))).toBe(true);
  });
});
