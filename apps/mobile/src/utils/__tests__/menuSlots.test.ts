import {
  addSlot,
  canRemoveSlot,
  nextSlotId,
  normalizeSlots,
  removeSlot,
  renumberSlots,
  isAutoFillSlot,
  setSlotAutoFill,
} from '../menuSlots';
import type { WeekSlotSetting } from '../menuWeek';

const MAIN: WeekSlotSetting = { slotId: 'main', slotKind: 'main', label: 'MAIN', position: 0 };
const SIDE: WeekSlotSetting = { slotId: 'side', slotKind: 'side', label: 'SIDE', position: 1 };

describe('nextSlotId', () => {
  it('その種類が無ければ種類名そのもの', () => {
    expect(nextSlotId([MAIN], 'side')).toBe('side');
  });

  it('2 つ目からは連番', () => {
    expect(nextSlotId([MAIN, SIDE], 'side')).toBe('side-2');
  });

  it('空き番号を使い回す（手元の状態からは「昔あった ID」を知りようがない）', () => {
    const slots = [MAIN, SIDE, { ...SIDE, slotId: 'side-3', position: 2 }];
    expect(nextSlotId(slots, 'side')).toBe('side-2');
    const afterAdd = [...slots, { ...SIDE, slotId: 'side-2', position: 3 }];
    expect(nextSlotId(afterAdd, 'side')).toBe('side-4');
  });
});

describe('addSlot', () => {
  it('主菜以外は末尾に足す', () => {
    const next = addSlot([MAIN], 'soup', 'SOUP');
    expect(next.map((s) => s.slotId)).toEqual(['main', 'soup']);
    expect(next.map((s) => s.position)).toEqual([0, 1]);
  });

  it('同じ種類を 2 つ持てる（副菜 2 品）', () => {
    const next = addSlot(addSlot([MAIN], 'side', 'SIDE'), 'side', 'SIDE');
    expect(next.map((s) => s.slotId)).toEqual(['main', 'side', 'side-2']);
  });

  it('主菜は先頭に入る', () => {
    const next = addSlot([SIDE], 'main', 'MAIN');
    expect(next.map((s) => s.slotId)).toEqual(['main', 'side']);
  });
});

describe('removeSlot', () => {
  it('指定した枠を消して position を詰める', () => {
    const slots = [MAIN, SIDE, { ...SIDE, slotId: 'soup', slotKind: 'soup', position: 2 }];
    const next = removeSlot(slots, 'side');
    expect(next.map((s) => s.slotId)).toEqual(['main', 'soup']);
    expect(next.map((s) => s.position)).toEqual([0, 1]);
  });

  it('**主菜は消せない**（渡されても無視する）', () => {
    expect(removeSlot([MAIN, SIDE], 'main').map((s) => s.slotId)).toEqual(['main', 'side']);
  });

  it('無い slotId を渡しても何も起きない', () => {
    expect(removeSlot([MAIN, SIDE], 'nope').map((s) => s.slotId)).toEqual(['main', 'side']);
  });
});

describe('canRemoveSlot', () => {
  it.each([
    ['main', false],
    ['side', true],
    ['side-2', true],
  ])('%s は %p', (slotId, expected) => {
    expect(canRemoveSlot(slotId)).toBe(expected);
  });
});

describe('renumberSlots', () => {
  it('position を 0 から振り直す', () => {
    const slots = [
      { ...MAIN, position: 5 },
      { ...SIDE, position: 9 },
    ];
    expect(renumberSlots(slots).map((s) => s.position)).toEqual([0, 1]);
  });
});

describe('normalizeSlots', () => {
  it('主菜が無ければ先頭に足す（同期で主菜だけ消えた状態から復帰する）', () => {
    const next = normalizeSlots([SIDE], 'MAIN');
    expect(next.map((s) => s.slotId)).toEqual(['main', 'side']);
    expect(next[0]?.label).toBe('MAIN');
  });

  it('主菜は position をいじられていても先頭に来る', () => {
    const next = normalizeSlots([{ ...MAIN, position: 9 }, SIDE], 'MAIN');
    expect(next.map((s) => s.slotId)).toEqual(['main', 'side']);
  });

  it('重複した slotId は先勝ちで落とす（同期で両端末が足すと起こりうる）', () => {
    const next = normalizeSlots([MAIN, SIDE, { ...SIDE, label: 'LATER', position: 2 }], 'MAIN');
    expect(next.map((s) => s.slotId)).toEqual(['main', 'side']);
    expect(next[1]?.label).toBe('SIDE');
  });

  it('既に正しい並びは変わらない', () => {
    expect(normalizeSlots([MAIN, SIDE], 'MAIN')).toEqual([MAIN, SIDE]);
  });
});

describe('autoFill（PR-5a）— 手入力専用の枠', () => {
  it('足した枠は autoFill:true で始まる', () => {
    const next = addSlot([MAIN], 'side', 'SIDE');
    expect(next.find((s) => s.slotId === 'side')?.autoFill).toBe(true);
  });

  it('setSlotAutoFill で切り替わる', () => {
    const slots = addSlot([MAIN], 'side', 'SIDE');
    const off = setSlotAutoFill(slots, 'side', false);
    expect(off.find((s) => s.slotId === 'side')?.autoFill).toBe(false);
    expect(off.filter((s) => s.slotId === 'side').map(isAutoFillSlot)).toEqual([false]);
  });

  it('**主菜は手入力専用にできない**（「組む」が何も組まなくなる）', () => {
    const next = setSlotAutoFill([MAIN, SIDE], 'main', false);
    expect(next.filter((s) => s.slotId === 'main').map(isAutoFillSlot)).toEqual([true]);
  });

  it('省略（v20 の行）は自動扱い', () => {
    expect(isAutoFillSlot({})).toBe(true);
    expect(isAutoFillSlot({ autoFill: undefined })).toBe(true);
  });
});
