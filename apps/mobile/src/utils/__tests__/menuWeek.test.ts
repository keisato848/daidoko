import {
  DEFAULT_SLOT_ID,
  buildWeekRows,
  dateKeyForDay,
  isDayDone,
  orderedSlots,
  weekProgress,
  type WeekDayRow,
  type WeekSlotRow,
  type WeekSlotSetting,
} from '../menuWeek';

const SETTINGS: WeekSlotSetting[] = [
  { slotId: 'side', slotKind: 'side', label: 'SIDE', position: 1 },
  { slotId: 'main', slotKind: 'main', label: 'MAIN', position: 0 },
];

/** 既定枠の文言は呼び出し側が渡す（純関数は t() を持たない） */
const FALLBACK = 'FALLBACK_MAIN';

function slot(day: number, slotId: string, over: Partial<WeekSlotRow> = {}): WeekSlotRow {
  return {
    day,
    slotId,
    recipeId: `r-${day}-${slotId}`,
    title: `title-${day}-${slotId}`,
    reason: '',
    doneAt: null,
    ...over,
  };
}

function build(
  slots: WeekSlotRow[],
  over: Partial<Parameters<typeof buildWeekRows>[0]> = {},
): WeekDayRow[] {
  return buildWeekRows({
    slots,
    settings: SETTINGS,
    anchorDate: '2026-09-18',
    today: new Date(2026, 8, 19), // 2026-09-19
    defaultSlotLabel: FALLBACK,
    ...over,
  });
}

/** `rows[0]!` を書かないための取り出し（no-non-null-assertion） */
function firstRow(rows: WeekDayRow[]): WeekDayRow {
  const row = rows[0];
  if (!row) throw new Error('行が 1 つも無い');
  return row;
}

describe('orderedSlots', () => {
  it('position の昇順に並べる', () => {
    expect(orderedSlots(SETTINGS, FALLBACK).map((s) => s.slotId)).toEqual(['main', 'side']);
  });

  it('設定が無ければ主菜 1 枠だけにし、文言は渡されたものを使う', () => {
    expect(orderedSlots([], FALLBACK)).toEqual([
      { slotId: DEFAULT_SLOT_ID, slotKind: 'main', label: FALLBACK, position: 0 },
    ]);
  });

  it('同じ slotId が重複したら後ろを捨てる', () => {
    const dup: WeekSlotSetting[] = [
      { slotId: 'main', slotKind: 'main', label: 'FIRST', position: 0 },
      { slotId: 'main', slotKind: 'main', label: 'SECOND', position: 2 },
      { slotId: 'soup', slotKind: 'soup', label: 'SOUP', position: 1 },
    ];
    expect(orderedSlots(dup, FALLBACK).map((s) => s.label)).toEqual(['FIRST', 'SOUP']);
  });
});

describe('dateKeyForDay', () => {
  it('day 1 は anchorDate そのもの', () => {
    expect(dateKeyForDay('2026-09-18', 1)).toBe('2026-09-18');
  });

  it('月をまたいでも繰り上がる', () => {
    expect(dateKeyForDay('2026-09-28', 5)).toBe('2026-10-02');
  });

  it('anchorDate が無ければ null（手動プランは日付を持たない）', () => {
    expect(dateKeyForDay(null, 3)).toBeNull();
  });

  it('壊れた anchorDate では null（NaN 日付を描かない）', () => {
    expect(dateKeyForDay('not-a-date', 1)).toBeNull();
  });
});

describe('buildWeekRows', () => {
  it('日番号の昇順で、枠は position 順に並べる', () => {
    const rows = build([slot(2, 'side'), slot(1, 'main'), slot(2, 'main')]);
    expect(rows.map((r) => r.day)).toEqual([1, 2]);
    expect(rows[1]?.slots.map((s) => s.slotId)).toEqual(['main', 'side']);
  });

  it('行が無い枠は entry: null で残す（未決定が見えるように）', () => {
    const row = firstRow(build([slot(1, 'main')]));
    expect(row.slots[0]?.entry?.recipeId).toBe('r-1-main');
    expect(row.slots[1]?.entry).toBeNull();
  });

  it('anchorDate から today に当たる日だけ isToday になる', () => {
    const rows = build([slot(1, 'main'), slot(2, 'main'), slot(3, 'main')]);
    expect(rows.map((r) => r.isToday)).toEqual([false, true, false]);
    expect(rows[1]?.dateKey).toBe('2026-09-19');
  });

  it('anchorDate が無ければ今日はどこにも立たない', () => {
    const rows = build([slot(1, 'main'), slot(2, 'main')], { anchorDate: null });
    expect(rows.every((r) => r.isToday === false)).toBe(true);
    expect(rows.every((r) => r.dateKey === null)).toBe(true);
  });

  it('7 日を超える献立は今週ぶんだけ出す', () => {
    const rows = build(Array.from({ length: 10 }, (_, i) => slot(i + 1, 'main')));
    expect(rows).toHaveLength(7);
    expect(rows.at(-1)?.day).toBe(7);
  });

  it('同じ (day, slotId) が重複したら先勝ちで 1 つだけ出す', () => {
    const rows = build([
      slot(1, 'main', { recipeId: 'first' }),
      slot(1, 'main', { recipeId: 'second' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slots[0]?.entry?.recipeId).toBe('first');
  });

  it('壊れた day（0・小数）は捨てる', () => {
    const rows = build([slot(0, 'main'), slot(1.5, 'main'), slot(1, 'main')]);
    expect(rows.map((r) => r.day)).toEqual([1]);
  });

  it('枠の設定が無ければ主菜 1 行だけになる', () => {
    const row = firstRow(build([slot(1, 'main')], { settings: [], anchorDate: null }));
    expect(row.slots).toHaveLength(1);
    expect(row.slots[0]?.label).toBe(FALLBACK);
  });
});

describe('isDayDone', () => {
  it('入っている枠が全部済んでいれば済み', () => {
    const row = firstRow(
      build([
        slot(1, 'main', { doneAt: '2026-09-18T10:00:00.000Z' }),
        slot(1, 'side', { doneAt: '2026-09-18T10:05:00.000Z' }),
      ]),
    );
    expect(isDayDone(row)).toBe(true);
  });

  it('副菜が残っていれば済みにしない', () => {
    const row = firstRow(
      build([slot(1, 'main', { doneAt: '2026-09-18T10:00:00.000Z' }), slot(1, 'side')]),
    );
    expect(isDayDone(row)).toBe(false);
  });

  it('空の枠は数に入れない（主菜だけ決めて作ったら済み）', () => {
    const row = firstRow(build([slot(1, 'main', { doneAt: '2026-09-18T10:00:00.000Z' })]));
    expect(isDayDone(row)).toBe(true);
  });

  it('献立が 1 つも無い日は済みではない', () => {
    const row = firstRow(build([slot(1, 'main')]));
    expect(isDayDone({ ...row, slots: row.slots.map((s) => ({ ...s, entry: null })) })).toBe(false);
  });
});

describe('weekProgress', () => {
  it('献立がある日だけを分母にする', () => {
    const rows = build([
      slot(1, 'main', { doneAt: '2026-09-18T10:00:00.000Z' }),
      slot(2, 'main'),
      slot(3, 'main', { doneAt: '2026-09-20T10:00:00.000Z' }),
    ]);
    expect(weekProgress(rows)).toEqual({ done: 2, total: 3 });
  });

  it('献立が無ければ 0/0', () => {
    expect(weekProgress([])).toEqual({ done: 0, total: 0 });
  });
});
