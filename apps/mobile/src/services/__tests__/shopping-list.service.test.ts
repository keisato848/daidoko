jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
}));

import {
  addRecipeIngredientsToList,
  addShoppingItem,
  clearCheckedShoppingItems,
  getShoppingItems,
  removeShoppingItem,
  setShoppingItemChecked,
} from '../shopping-list.service';

describe('shopping-list.service (web / non-native)', () => {
  it('returns an empty list', async () => {
    expect(await getShoppingItems()).toEqual([]);
  });

  it('does not add on web (returns null)', async () => {
    expect(await addShoppingItem('牛乳')).toBeNull();
  });

  it('rejects blank names before touching the platform', async () => {
    expect(await addShoppingItem('   ')).toBeNull();
  });

  it('adds nothing from a recipe on web', async () => {
    expect(await addRecipeIngredientsToList('recipe-1')).toBe(0);
  });

  it('mutations are safe no-ops on web', async () => {
    await expect(setShoppingItemChecked('x', true)).resolves.toBeUndefined();
    await expect(removeShoppingItem('x')).resolves.toBeUndefined();
    await expect(clearCheckedShoppingItems()).resolves.toBeUndefined();
  });
});
