import type { TimelineEntry } from '../../services/types';
import { buildMonthMatrix, groupEntriesByDay, localDayKey } from '../calendar';

function entry(cookedAt: string, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: Math.random().toString(36).slice(2),
    recipeId: 'r1',
    recipeTitle: '肉じゃが',
    userName: '恵',
    cookedAt,
    servings: 2,
    rating: null,
    memo: null,
    photos: [],
    ...overrides,
  };
}

describe('localDayKey', () => {
  it('ローカル日付の YYYY-MM-DD を返す', () => {
    expect(localDayKey(new Date(2026, 5, 7))).toBe('2026-06-07');
    expect(localDayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('buildMonthMatrix', () => {
  it('各週は7セル、日曜始まり', () => {
    const weeks = buildMonthMatrix(2026, 5); // June 2026
    weeks.forEach((w) => expect(w).toHaveLength(7));
    // 2026-06-01 is a Monday → first row starts with Sunday 05-31 (out of month)
    expect(weeks[0][0]).toMatchObject({ inMonth: false });
    expect(weeks[0][1]).toMatchObject({ day: 1, inMonth: true, key: '2026-06-01' });
  });

  it('当月の全日を含む', () => {
    const weeks = buildMonthMatrix(2026, 5);
    const inMonthDays = weeks
      .flat()
      .filter((c) => c.inMonth)
      .map((c) => c.day);
    expect(inMonthDays).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('年末(12月)も正しく生成し1月へ繰り越す', () => {
    const weeks = buildMonthMatrix(2026, 11); // December 2026
    const dec = weeks.flat().filter((c) => c.inMonth);
    expect(dec).toHaveLength(31);
    // trailing cells belong to next January
    const trailing = weeks.flat().filter((c) => !c.inMonth && c.key.startsWith('2027-01'));
    expect(trailing.length).toBeGreaterThan(0);
  });

  it('2月(28日)を5週以内で生成', () => {
    const weeks = buildMonthMatrix(2027, 1); // Feb 2027
    expect(weeks.flat().filter((c) => c.inMonth)).toHaveLength(28);
  });
});

describe('groupEntriesByDay', () => {
  it('同じ日のログをまとめる', () => {
    // Build from LOCAL dates so the test is timezone-independent.
    const morning7 = new Date(2026, 5, 7, 9, 0).toISOString();
    const evening7 = new Date(2026, 5, 7, 20, 0).toISOString();
    const day8 = new Date(2026, 5, 8, 12, 0).toISOString();
    const map = groupEntriesByDay([entry(morning7), entry(evening7), entry(day8)]);
    expect(map.get('2026-06-07')).toHaveLength(2);
    expect(map.get('2026-06-08')).toHaveLength(1);
  });

  it('空配列なら空Map', () => {
    expect(groupEntriesByDay([]).size).toBe(0);
  });
});
