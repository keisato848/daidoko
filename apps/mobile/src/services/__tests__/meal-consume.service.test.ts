jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
}));

import { applyConsumption } from '../meal-consume.service';

describe('meal-consume.service (web / non-native)', () => {
  it('applyConsumption is a safe no-op on web', async () => {
    expect(await applyConsumption(['x', 'y'])).toBe(0);
  });

  it('applyConsumption handles an empty list', async () => {
    expect(await applyConsumption([])).toBe(0);
  });
});
