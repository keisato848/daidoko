/**
 * Pure helpers for the cooking-log calendar view (R12 / 利用フロー §5)
 */
import type { TimelineEntry } from '../services/types';

export interface CalendarCell {
  /** Day of month (1-31) */
  day: number;
  /** Local date key 'YYYY-MM-DD' */
  key: string;
  /** Whether this cell belongs to the displayed month */
  inMonth: boolean;
}

/** Local (device-timezone) date key 'YYYY-MM-DD' for grouping by calendar day. */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build a calendar matrix (weeks of 7 cells, Sunday-first) for the given month.
 * Leading/trailing cells from adjacent months are included with inMonth=false
 * so every week has exactly 7 cells.
 */
export function buildMonthMatrix(year: number, month: number): CalendarCell[][] {
  const startOffset = new Date(year, month, 1).getDay(); // 0 = Sunday
  const lastDay = new Date(year, month + 1, 0).getDate();
  const numWeeks = Math.ceil((startOffset + lastDay) / 7);

  const cursor = new Date(year, month, 1 - startOffset);
  const weeks: CalendarCell[][] = [];

  for (let w = 0; w < numWeeks; w++) {
    const week: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        day: cursor.getDate(),
        key: localDayKey(cursor),
        inMonth: cursor.getMonth() === month,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Group timeline entries by their local cooked-day key. */
export function groupEntriesByDay(entries: TimelineEntry[]): Map<string, TimelineEntry[]> {
  const map = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const key = localDayKey(new Date(entry.cookedAt));
    const list = map.get(key);
    if (list) {
      list.push(entry);
    } else {
      map.set(key, [entry]);
    }
  }
  return map;
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;
