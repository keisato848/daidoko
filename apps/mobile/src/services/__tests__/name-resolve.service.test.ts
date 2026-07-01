jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
}));

import { getResolveMode, grantResolveAdBonus, resolvePantryNames } from '../name-resolve.service';

describe('name-resolve.service (web / non-native)', () => {
  it('reports mode "none" when not native', async () => {
    expect(await getResolveMode()).toBe('none');
  });

  it('resolvePantryNames is a safe no-op on web', async () => {
    expect(await resolvePantryNames()).toEqual({
      resolved: 0,
      remaining: 0,
      mode: 'none',
      canWatchAd: false,
    });
  });

  it('grantResolveAdBonus is a safe no-op on web', async () => {
    await expect(grantResolveAdBonus()).resolves.toBeUndefined();
  });
});
