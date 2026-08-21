/**
 * 店名 → 買い物グループ の対応表（v13）。
 * web（非ネイティブ）では黙って無効になり、呼び出し側が分岐しなくてよいことを固定する。
 */
jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
}));

import {
  deleteStoreGroupAlias,
  getShoppingStoreGroups,
  getStoreGroupAliases,
  getStoreGroupFor,
  learnStoreGroup,
} from '../store-group.service';

describe('store-group.service（web / 非ネイティブ）', () => {
  it('対応は引けない（null）', async () => {
    expect(await getStoreGroupFor('マックスバリュ松山店')).toBeNull();
  });

  it('空の店名は引かない（DB を触る前に弾く）', async () => {
    expect(await getStoreGroupFor('   ')).toBeNull();
  });

  it('学習・削除は安全な no-op（例外を投げない）', async () => {
    await expect(learnStoreGroup('店', 'スーパー')).resolves.toBeUndefined();
    await expect(learnStoreGroup('  ', 'スーパー')).resolves.toBeUndefined();
    await expect(deleteStoreGroupAlias('id')).resolves.toBeUndefined();
  });

  it('一覧は空', async () => {
    expect(await getStoreGroupAliases()).toEqual([]);
    expect(await getShoppingStoreGroups()).toEqual([]);
  });
});
