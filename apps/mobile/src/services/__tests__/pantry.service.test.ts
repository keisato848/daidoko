jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
}));

import {
  addPantryItem,
  getInStockNormalizedNames,
  getPantryItems,
  moveCheckedShoppingItemsToPantry,
  removePantryItem,
  updatePantryItem,
} from '../pantry.service';

describe('pantry.service (web / non-native)', () => {
  it('returns an empty pantry', async () => {
    expect(await getPantryItems()).toEqual([]);
  });

  it('does not add on web (returns null)', async () => {
    expect(await addPantryItem('玉ねぎ', { quantity: 3, unit: '個' })).toBeNull();
  });

  it('rejects blank names', async () => {
    expect(await addPantryItem('   ')).toBeNull();
  });

  it('reports an empty in-stock list', async () => {
    expect(await getInStockNormalizedNames()).toEqual([]);
  });

  it('moves nothing when not native', async () => {
    expect(await moveCheckedShoppingItemsToPantry()).toBe(0);
  });

  it('mutations are safe no-ops on web', async () => {
    await expect(updatePantryItem('x', { quantity: 1 })).resolves.toBeUndefined();
    await expect(removePantryItem('x')).resolves.toBeUndefined();
  });
});
