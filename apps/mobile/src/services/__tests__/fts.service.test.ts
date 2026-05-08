jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
  getExpoDb: jest.fn(),
}));

import { searchByFts, updateFtsIndex, removeFtsEntry } from '../fts.service';

describe('fts.service (mock/web)', () => {
  it('searchByFts returns empty array on web', async () => {
    const results = await searchByFts('肉');
    expect(results).toEqual([]);
  });

  it('searchByFts returns empty for empty query', async () => {
    const results = await searchByFts('');
    expect(results).toEqual([]);
  });

  it('updateFtsIndex does not throw on web', async () => {
    await expect(
      updateFtsIndex('recipe-1', '肉じゃが', 'にくじゃが', ['じゃがいも', '玉ねぎ']),
    ).resolves.not.toThrow();
  });

  it('removeFtsEntry does not throw on web', async () => {
    await expect(removeFtsEntry('recipe-1')).resolves.not.toThrow();
  });
});
