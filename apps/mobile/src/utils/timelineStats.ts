/**
 * Pure helpers for the home screen monthly summary (S03 "月の統計")
 */
import type { TimelineEntry } from '../services/types';

export interface MonthlyStats {
  /** Number of cooking logs recorded in the current calendar month */
  count: number;
  /** Distinct recipe titles cooked this month */
  dishes: number;
  /** Average star rating this month, rounded to 1 decimal, or null when unrated */
  avgRating: number | null;
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Compute this-month cooking stats from the full (unfiltered) timeline.
 * `now` is injectable for deterministic tests.
 */
export function computeMonthlyStats(
  entries: TimelineEntry[],
  now: Date = new Date(),
): MonthlyStats {
  const thisMonth = entries.filter((entry) => isSameMonth(new Date(entry.cookedAt), now));

  const dishes = new Set(thisMonth.map((entry) => entry.recipeTitle)).size;

  const ratings = thisMonth
    .map((entry) => entry.rating)
    .filter((rating): rating is number => rating != null);
  const avgRating =
    ratings.length > 0
      ? Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10
      : null;

  return { count: thisMonth.length, dishes, avgRating };
}
