jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
}));

import { lookupJan, rememberJan } from '../jan.service';

describe('jan.service (web / non-native)', () => {
  it('returns null for any lookup', async () => {
    expect(await lookupJan('4901234567894')).toBeNull();
  });

  it('returns null for a blank code', async () => {
    expect(await lookupJan('')).toBeNull();
  });

  it('remember is a safe no-op on web', async () => {
    await expect(rememberJan('4901234567894', '牛乳', '本')).resolves.toBeUndefined();
  });
});
