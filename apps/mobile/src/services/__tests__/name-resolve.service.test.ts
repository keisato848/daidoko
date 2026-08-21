jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
}));

import {
  getResolveMode,
  grantResolveAdBonus,
  resolveUnmatchedNames,
} from '../name-resolve.service';

describe('name-resolve.service (web / non-native)', () => {
  it('reports mode "none" when not native', async () => {
    expect(await getResolveMode()).toBe('none');
  });

  it('resolveUnmatchedNames is a safe no-op on web', async () => {
    expect(await resolveUnmatchedNames()).toEqual({
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
