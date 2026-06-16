import type { TimelineEntry } from '../../services/types';
import { computeMonthlyStats } from '../timelineStats';

function entry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: Math.random().toString(36).slice(2),
    recipeId: 'r1',
    recipeTitle: '肉じゃが',
    userName: '恵',
    cookedAt: '2026-06-10T12:00:00.000Z',
    servings: 2,
    rating: null,
    memo: null,
    photos: [],
    ...overrides,
  };
}

describe('computeMonthlyStats', () => {
  const now = new Date('2026-06-15T09:00:00.000Z');

  it('当月のログ数を数える', () => {
    const stats = computeMonthlyStats(
      [
        entry({ cookedAt: '2026-06-01T00:00:00.000Z' }),
        entry({ cookedAt: '2026-06-14T00:00:00.000Z' }),
        entry({ cookedAt: '2026-05-30T00:00:00.000Z' }), // 前月は除外
      ],
      now,
    );
    expect(stats.count).toBe(2);
  });

  it('当月の品数（重複しないレシピ名）を数える', () => {
    const stats = computeMonthlyStats(
      [
        entry({ recipeTitle: '肉じゃが', cookedAt: '2026-06-02T00:00:00.000Z' }),
        entry({ recipeTitle: '肉じゃが', cookedAt: '2026-06-09T00:00:00.000Z' }),
        entry({ recipeTitle: '味噌汁', cookedAt: '2026-06-10T00:00:00.000Z' }),
      ],
      now,
    );
    expect(stats.dishes).toBe(2);
  });

  it('当月の平均評価を小数第1位で返す', () => {
    const stats = computeMonthlyStats(
      [
        entry({ rating: 5, cookedAt: '2026-06-02T00:00:00.000Z' }),
        entry({ rating: 4, cookedAt: '2026-06-09T00:00:00.000Z' }),
        entry({ rating: null, cookedAt: '2026-06-10T00:00:00.000Z' }), // 無評価は平均に含めない
      ],
      now,
    );
    expect(stats.avgRating).toBe(4.5);
  });

  it('評価が無ければ avgRating は null', () => {
    const stats = computeMonthlyStats([entry({ rating: null })], now);
    expect(stats.avgRating).toBeNull();
  });

  it('当月のログが無ければ全て 0 / null', () => {
    const stats = computeMonthlyStats([entry({ cookedAt: '2026-04-01T00:00:00.000Z' })], now);
    expect(stats).toEqual({ count: 0, dishes: 0, avgRating: null });
  });
});
