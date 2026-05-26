/**
 * Unit tests for cooking-log.service (web/mock path)
 */
jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
  getExpoDb: jest.fn(),
}));

import { createCookingLog, deleteCookingLog, getLogsForRecipe } from '../cooking-log.service';
import { getTimeline } from '../timeline.service';

describe('createCookingLog', () => {
  it('returns a non-empty id', async () => {
    const id = await createCookingLog({
      recipeId: 'recipe-tonnjiru',
      rating: 5,
      memo: 'とても美味しかった',
      cookedAt: new Date('2026-05-08T12:00:00Z').toISOString(),
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('creates log without memo', async () => {
    const id = await createCookingLog({
      recipeId: 'recipe-nikujaga',
      rating: 4,
      cookedAt: new Date('2026-05-08T18:00:00Z').toISOString(),
    });
    expect(id).toBeTruthy();
  });

  it('creates log without rating', async () => {
    const id = await createCookingLog({
      recipeId: 'recipe-nikujaga',
      cookedAt: new Date('2026-05-08T18:00:00Z').toISOString(),
    });
    expect(id).toBeTruthy();
  });

  it('creates a free cooking log without a recipe link', async () => {
    const id = await createCookingLog({
      servings: 2,
      rating: 4,
      memo: '思いつきで作った記録',
      cookedAt: '2026-05-13T18:00:00.000Z',
    });

    const timeline = await getTimeline();
    const found = timeline.find((entry) => entry.id === id);
    expect(found).toMatchObject({
      recipeId: null,
      recipeTitle: 'フリー記録',
      servings: 2,
      rating: 4,
      memo: '思いつきで作った記録',
    });
  });

  it.each([
    ['rating below range', { rating: 0 }],
    ['rating above range', { rating: 6 }],
    ['servings below range', { servings: 0 }],
    ['servings above range', { servings: 100 }],
    ['memo too long', { memo: 'あ'.repeat(501) }],
    ['invalid cookedAt', { cookedAt: 'not-a-date' }],
  ])('rejects invalid cooking log input: %s', async (_label, overrides) => {
    await expect(
      createCookingLog({
        recipeId: 'recipe-1',
        cookedAt: '2026-05-14T18:00:00.000Z',
        ...overrides,
      }),
    ).rejects.toThrow(RangeError);
  });

  it('created log appears in getLogsForRecipe', async () => {
    const recipeId = 'recipe-karaage';
    await createCookingLog({
      recipeId,
      rating: 3,
      memo: 'ニンニク多め',
      cookedAt: new Date('2026-05-09T19:00:00Z').toISOString(),
    });
    const logs = await getLogsForRecipe(recipeId);
    const found = logs.find((l) => l.recipeId === recipeId && l.memo === 'ニンニク多め');
    expect(found).toBeDefined();
    expect(found?.rating).toBe(3);
  });

  it('creates log with multiple photos and returns them in sort order', async () => {
    const recipeId = 'recipe-3';
    const id = await createCookingLog({
      recipeId,
      rating: 5,
      memo: '写真つきの記録',
      cookedAt: '2026-05-10T19:00:00.000Z',
      photos: [
        {
          localPath: 'file:///data/user/0/com.daidoko.app/cache/photo_1.jpg',
          takenAt: '2026-05-10T18:55:00.000Z',
        },
        {
          localPath: 'file:///data/user/0/com.daidoko.app/cache/photo_2.png',
          cloudUrl: 'https://r2.example.com/daidoko/photos/photo-log-test-2.webp',
          takenAt: '2026-05-10T18:57:00.000Z',
        },
      ],
    });

    const logs = await getLogsForRecipe(recipeId);
    const found = logs.find((log) => log.id === id);

    expect(found?.photos).toHaveLength(2);
    expect(found?.photos.map((photo) => photo.sortOrder)).toEqual([1, 2]);
    expect(found?.photos[0]).toMatchObject({
      localPath: 'file:///data/user/0/com.daidoko.app/cache/photo_1.jpg',
      cloudUrl: null,
      takenAt: '2026-05-10T18:55:00.000Z',
    });
    expect(found?.photos[1]).toMatchObject({
      localPath: 'file:///data/user/0/com.daidoko.app/cache/photo_2.png',
      cloudUrl: 'https://r2.example.com/daidoko/photos/photo-log-test-2.webp',
      takenAt: '2026-05-10T18:57:00.000Z',
    });
  });
});

describe('getLogsForRecipe', () => {
  it('returns only logs for the given recipeId', async () => {
    const logs = await getLogsForRecipe('recipe-nikujaga');
    expect(Array.isArray(logs)).toBe(true);
    for (const log of logs) {
      expect(log.recipeId).toBe('recipe-nikujaga');
    }
  });

  it('returns empty array for unknown recipeId', async () => {
    const logs = await getLogsForRecipe('non-existent-id-xyz');
    expect(logs).toEqual([]);
  });

  it('returns logs sorted by cookedAt descending', async () => {
    const recipeId = 'recipe-misoshiru';
    await createCookingLog({ recipeId, rating: 5, cookedAt: '2026-01-01T10:00:00Z' });
    await createCookingLog({ recipeId, rating: 4, cookedAt: '2026-06-01T10:00:00Z' });
    const logs = await getLogsForRecipe(recipeId);
    for (let i = 1; i < logs.length; i++) {
      expect(logs[i - 1].cookedAt >= logs[i].cookedAt).toBe(true);
    }
  });

  it('each entry has required fields', async () => {
    const recipeId = 'recipe-tonnjiru';
    const logs = await getLogsForRecipe(recipeId);
    if (logs.length > 0) {
      const log = logs[0];
      expect(log).toHaveProperty('id');
      expect(log).toHaveProperty('recipeId');
      expect(log).toHaveProperty('userName');
      expect(log).toHaveProperty('cookedAt');
      expect(log).toHaveProperty('photos');
      expect(Array.isArray(log.photos)).toBe(true);
    }
  });

  it('returns an empty photos array for logs without photos', async () => {
    const recipeId = 'recipe-2';
    const id = await createCookingLog({
      recipeId,
      rating: 4,
      cookedAt: '2026-05-11T18:00:00.000Z',
    });

    const logs = await getLogsForRecipe(recipeId);
    const found = logs.find((log) => log.id === id);
    expect(found?.photos).toEqual([]);
  });

  it('preserves servings on recipe cooking logs', async () => {
    const recipeId = 'recipe-5';
    const id = await createCookingLog({
      recipeId,
      servings: 6,
      cookedAt: '2026-05-15T18:00:00.000Z',
    });

    const logs = await getLogsForRecipe(recipeId);
    const found = logs.find((log) => log.id === id);
    expect(found?.servings).toBe(6);
  });

  it('timeline includes photos for newly created cooking logs', async () => {
    const recipeId = 'recipe-1';
    const id = await createCookingLog({
      recipeId,
      memo: 'タイムライン写真確認',
      cookedAt: '2026-05-12T18:00:00.000Z',
      photos: [
        {
          localPath: 'file:///data/user/0/com.daidoko.app/cache/timeline_photo.jpg',
        },
      ],
    });

    const timeline = await getTimeline();
    const found = timeline.find((entry) => entry.id === id);
    expect(found?.photos).toHaveLength(1);
    expect(found?.photos[0].localPath).toBe(
      'file:///data/user/0/com.daidoko.app/cache/timeline_photo.jpg',
    );
  });

  it('deletes a cooking log from timeline and recipe history', async () => {
    const recipeId = 'recipe-1';
    const id = await createCookingLog({
      recipeId,
      memo: '削除テスト用の調理ログ',
      cookedAt: '2026-05-16T18:00:00.000Z',
      photos: [{ localPath: 'file:///data/user/0/com.daidoko.app/cache/delete_me.jpg' }],
    });

    await deleteCookingLog(id);

    const timeline = await getTimeline();
    const logs = await getLogsForRecipe(recipeId);
    expect(timeline.find((entry) => entry.id === id)).toBeUndefined();
    expect(logs.find((entry) => entry.id === id)).toBeUndefined();
  });
});
