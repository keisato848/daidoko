jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
  getExpoDb: jest.fn(),
}));

import { createCookingLog } from '../cooking-log.service';
import { createRecipe, deleteRecipe } from '../recipe.service';
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

  it('prevents navigation to archived recipes from timeline entries', async () => {
    const recipeId = await createRecipe({
      title: '削除済みタイムライン確認',
      ingredients: [{ name: '大根' }],
      steps: [{ body: '煮る' }],
      tags: [],
    });

    const logId = await createCookingLog({
      recipeId,
      memo: '削除前の調理記録',
      cookedAt: '2026-05-22T11:00:00.000Z',
    });

    await deleteRecipe(recipeId);

    const entries = await getTimeline();
    const entry = entries.find((item) => item.id === logId);

    expect(entry).toBeDefined();
    expect(entry?.recipeTitle).toBe('削除済みタイムライン確認');
    expect(entry?.recipeId).toBeNull();
  });
});
