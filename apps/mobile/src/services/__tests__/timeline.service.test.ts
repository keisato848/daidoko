jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
  getExpoDb: jest.fn(),
}));

import { getTimeline } from '../timeline.service';

describe('timeline.service (mock/web)', () => {
  it('returns an array of timeline entries', async () => {
    const entries = await getTimeline();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('entries have required fields', async () => {
    const entries = await getTimeline();
    const entry = entries[0];
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('recipeTitle');
    expect(entry).toHaveProperty('userName');
    expect(entry).toHaveProperty('cookedAt');
  });

  it('entries are sorted by date descending', async () => {
    const entries = await getTimeline();
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].cookedAt >= entries[i].cookedAt).toBe(true);
    }
  });

  it('entries have valid recipe titles', async () => {
    const entries = await getTimeline();
    entries.forEach((entry) => {
      expect(entry.recipeTitle.length).toBeGreaterThan(0);
    });
  });
});
