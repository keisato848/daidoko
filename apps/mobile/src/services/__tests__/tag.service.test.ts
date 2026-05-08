jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
  getExpoDb: jest.fn(),
}));

import { getTagsForFamily } from '../tag.service';

describe('tag.service (mock/web)', () => {
  it('returns an array of tags', async () => {
    const tags = await getTagsForFamily();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
  });

  it('each tag has id and name', async () => {
    const tags = await getTagsForFamily();
    tags.forEach((tag) => {
      expect(tag).toHaveProperty('id');
      expect(tag).toHaveProperty('name');
      expect(tag.name.length).toBeGreaterThan(0);
    });
  });

  it('includes seed tags', async () => {
    const tags = await getTagsForFamily();
    const names = tags.map((t) => t.name);
    expect(names).toContain('肉');
    expect(names).toContain('汁物');
    expect(names).toContain('洋食');
  });
});
