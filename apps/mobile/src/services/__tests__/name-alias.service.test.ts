jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
}));

import { cacheAliases, getAliasMap, getUncachedNames } from '../name-alias.service';

describe('name-alias.service (web / non-native)', () => {
  it('returns an empty alias map', async () => {
    expect(await getAliasMap()).toEqual({});
  });

  it('reports all distinct names as uncached when the cache is empty', async () => {
    expect(await getUncachedNames(['たまご', 'たまご', '牛乳', ''])).toEqual(['たまご', '牛乳']);
  });

  it('cacheAliases is a safe no-op on web', async () => {
    await expect(
      cacheAliases([{ sourceNormalized: 'とっとごたまご', canonical: '卵' }]),
    ).resolves.toBeUndefined();
  });
});
