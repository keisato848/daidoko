jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
}));

import {
  addRecipeIngredientsToList,
  addShoppingItem,
  describeAddMissingResult,
  getShoppingItems,
  removeShoppingItem,
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
    await expect(removeShoppingItem('x')).resolves.toBeUndefined();
  });
});

/**
 * 「在庫にある」と「もう買い物リストに入っている（未購入）」の取り違え。
 * まとめて 0 件として返していたため、リストに入れたままの材料しかないときに
 * 「すべて在庫にあります」と出て、**持っていない材料を持っていることにしていた**。
 */
describe('describeAddMissingResult', () => {
  it('リストに入っているだけの材料を「在庫にある」と言わない', () => {
    const outcome = describeAddMissingResult({
      added: 0,
      alreadyInPantry: 0,
      alreadyOnList: 3,
    });
    expect(outcome).toEqual({ kind: 'all-on-list' });
  });

  it('本当に全部在庫にあるときだけ nothing-missing', () => {
    expect(describeAddMissingResult({ added: 0, alreadyInPantry: 4, alreadyOnList: 0 })).toEqual({
      kind: 'nothing-missing',
    });
  });

  it('在庫ぶんとリストぶんが混ざっていても、リストが1件でもあれば在庫扱いにしない', () => {
    expect(describeAddMissingResult({ added: 0, alreadyInPantry: 3, alreadyOnList: 1 })).toEqual({
      kind: 'all-on-list',
    });
  });

  it('追加できたときは、すでにリストにあった数も併せて返す', () => {
    expect(describeAddMissingResult({ added: 2, alreadyInPantry: 1, alreadyOnList: 3 })).toEqual({
      kind: 'added',
      added: 2,
      alreadyOnList: 3,
    });
  });

  it('何も足りなければ nothing-missing（材料ゼロのレシピ）', () => {
    expect(describeAddMissingResult({ added: 0, alreadyInPantry: 0, alreadyOnList: 0 })).toEqual({
      kind: 'nothing-missing',
    });
  });
});
