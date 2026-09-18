/**
 * 週ビューの 1 日（PR-3）。**描き分けだけ**をここで固定する
 * （どの日がいつか・済みかの判断は `utils/menuWeek.ts` のテストが持つ）。
 *
 * 見ているのは「画面が嘘をつく」経路: 無くなったレシピを開かせない・
 * 空の枠を献立として描かない・主菜が無い日に差し替えを出さない。
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { MenuWeekRow } from '../MenuWeekRow';
import type { SlotRecipeMeta } from '../MenuSlotLine';
import { buildWeekRows, type WeekDayRow } from '../../utils/menuWeek';

const SETTINGS = [
  { slotId: 'main', slotKind: 'main', label: '主菜', position: 0 },
  { slotId: 'side', slotKind: 'side', label: '副菜', position: 1 },
];

function rowFor(
  slots: { day: number; slotId: string; recipeId: string; title: string; doneAt?: string | null }[],
  anchorDate: string | null = '2026-09-18',
): WeekDayRow {
  const rows = buildWeekRows({
    slots: slots.map((s) => ({ ...s, reason: '', doneAt: s.doneAt ?? null })),
    settings: SETTINGS,
    anchorDate,
    today: new Date(2026, 8, 18),
    defaultSlotLabel: '主菜',
  });
  const row = rows[0];
  if (!row) throw new Error('行が無い');
  return row;
}

function renderRow(row: WeekDayRow, meta: [string, SlotRecipeMeta][] = []) {
  const onOpenRecipe = jest.fn();
  const onSwap = jest.fn();
  render(
    <MenuWeekRow
      row={row}
      metaByRecipeId={new Map(meta)}
      busy={false}
      onOpenRecipe={onOpenRecipe}
      onSwap={onSwap}
    />,
  );
  return { onOpenRecipe, onSwap };
}

describe('MenuWeekRow', () => {
  it('枠ごとに 1 行ずつ出し、空の枠は「まだ決めていません」になる', () => {
    renderRow(rowFor([{ day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }]));
    expect(screen.getByText('肉じゃが')).toBeTruthy();
    expect(screen.getByText('副菜')).toBeTruthy();
    expect(screen.getByText('まだ決めていません')).toBeTruthy();
  });

  it('料理名を押すとそのレシピを開く', () => {
    const { onOpenRecipe } = renderRow(
      rowFor([{ day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }]),
    );
    fireEvent.press(screen.getByText('肉じゃが'));
    expect(onOpenRecipe).toHaveBeenCalledWith('r1');
  });

  it('無くなったレシピは料理名を出さず、押しても開かない', () => {
    const { onOpenRecipe } = renderRow(
      rowFor([{ day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }]),
      [['r1', { missing: true, cookTimeMin: null }]],
    );
    expect(screen.queryByText('肉じゃが')).toBeNull();
    const gone = screen.getByText('このレシピは無くなりました');
    fireEvent.press(gone);
    expect(onOpenRecipe).not.toHaveBeenCalled();
  });

  it('無くなったレシピの日には差し替えを出さない（候補の元が無い）', () => {
    renderRow(rowFor([{ day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }]), [
      ['r1', { missing: true, cookTimeMin: null }],
    ]);
    expect(screen.queryByText('差し替え')).toBeNull();
  });

  it('差し替えを押すとその日の番号を返す', () => {
    const { onSwap } = renderRow(
      rowFor([{ day: 2, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }]),
    );
    fireEvent.press(screen.getByText('差し替え'));
    expect(onSwap).toHaveBeenCalledWith(2);
  });

  it('anchorDate があれば日付と曜日を出す', () => {
    renderRow(rowFor([{ day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }]));
    expect(screen.getByText('9/18（金）')).toBeTruthy();
  });

  it('anchorDate が無ければ「N日目」のまま（日付を作らない）', () => {
    renderRow(rowFor([{ day: 3, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }], null));
    expect(screen.getByText('3日目')).toBeTruthy();
    expect(screen.queryByText('今日')).toBeNull();
  });

  it('今日の行には「今日」を出す', () => {
    renderRow(rowFor([{ day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }]));
    expect(screen.getByText('今日')).toBeTruthy();
  });

  // 受付票 C:「記号でなく『予定』『済み』の文字が出る」。✓ に戻すとここが赤くなる
  it('献立が入っている枠に「予定」「済み」を文字で出す', () => {
    renderRow(
      rowFor([
        { day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが', doneAt: 'done' },
        { day: 1, slotId: 'side', recipeId: 'r2', title: '豚汁' },
      ]),
    );
    expect(screen.getByText('済み')).toBeTruthy();
    expect(screen.getByText('予定')).toBeTruthy();
  });

  it('空の枠には状態を出さない（まだ決めていないものに「予定」と言わない）', () => {
    renderRow(rowFor([{ day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }]));
    // main は「予定」、side は空なので状態なし
    expect(screen.getAllByText('予定')).toHaveLength(1);
  });

  it('無くなったレシピには状態を出さない', () => {
    renderRow(rowFor([{ day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }]), [
      ['r1', { missing: true, cookTimeMin: null }],
    ]);
    expect(screen.queryByText('予定')).toBeNull();
    expect(screen.queryByText('済み')).toBeNull();
  });

  it('調理時間があれば添える', () => {
    renderRow(rowFor([{ day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが' }]), [
      ['r1', { missing: false, cookTimeMin: 25 }],
    ]);
    expect(screen.getByText('25分')).toBeTruthy();
  });
});
