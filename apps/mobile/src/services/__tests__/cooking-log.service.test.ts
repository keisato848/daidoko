/**
 * Unit tests for cooking-log.service (web/mock path)
 */
jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
  getExpoDb: jest.fn(),
}));

import { createCookingLog, getLogsForRecipe } from '../cooking-log.service';

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
    }
  });
});
