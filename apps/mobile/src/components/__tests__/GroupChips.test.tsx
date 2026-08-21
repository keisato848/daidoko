/**
 * グループのチップ（v13）。守りたい約束は 2 つ。
 *
 * 1. **グループを使っていない人の画面は変えない** — グループが 0 件ならチップ自体を出さない。
 *    任意の機能なので、使わない人に UI を増やしてはいけない。
 * 2. **「未設定」は常に選べる** — 絞り込みで未設定の品が覗けないと、振り分け忘れた品が
 *    埋もれて買い忘れ・二重買いになる。
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { GroupChips } from '../GroupChips';
import { GroupMultiChips } from '../GroupMultiChips';

const UNGROUPED = '__ungrouped__';

describe('GroupChips（絞り込み・単一選択）', () => {
  it('グループが 0 件なら何も出さない', () => {
    const { toJSON } = render(
      <GroupChips
        groups={[]}
        selected={null}
        onSelect={jest.fn()}
        allLabel="すべて"
        ungroupedLabel="未設定"
        ungroupedValue={UNGROUPED}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('「すべて」「各グループ」「未設定」を出す', () => {
    render(
      <GroupChips
        groups={['冷蔵庫', '備蓄']}
        selected={null}
        onSelect={jest.fn()}
        allLabel="すべて"
        ungroupedLabel="未設定"
        ungroupedValue={UNGROUPED}
      />,
    );
    expect(screen.getByText('すべて')).toBeTruthy();
    expect(screen.getByText('冷蔵庫')).toBeTruthy();
    expect(screen.getByText('備蓄')).toBeTruthy();
    expect(screen.getByText('未設定')).toBeTruthy();
  });

  it('未設定を選ぶと番兵の値で通知する（null=すべて と区別する）', () => {
    const onSelect = jest.fn();
    render(
      <GroupChips
        groups={['冷蔵庫']}
        selected={null}
        onSelect={onSelect}
        allLabel="すべて"
        ungroupedLabel="未設定"
        ungroupedValue={UNGROUPED}
      />,
    );
    fireEvent.press(screen.getByText('未設定'));
    expect(onSelect).toHaveBeenCalledWith(UNGROUPED);

    fireEvent.press(screen.getByText('すべて'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('GroupMultiChips（相談で送る在庫・複数選択）', () => {
  it('グループが 0 件なら何も出さない', () => {
    const { toJSON } = render(
      <GroupMultiChips
        groups={[]}
        selected={[]}
        onToggle={jest.fn()}
        ungroupedLabel="未設定"
        ungroupedValue={UNGROUPED}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('「すべて」チップは出さない（空の選択が すべて を意味する）', () => {
    render(
      <GroupMultiChips
        groups={['冷蔵庫']}
        selected={[]}
        onToggle={jest.fn()}
        ungroupedLabel="未設定"
        ungroupedValue={UNGROUPED}
      />,
    );
    expect(screen.queryByText('すべて')).toBeNull();
    expect(screen.getByText('未設定')).toBeTruthy();
  });

  it('押した名前をそのまま返す（外側で足し引きする）', () => {
    const onToggle = jest.fn();
    render(
      <GroupMultiChips
        groups={['冷蔵庫', '備蓄']}
        selected={['冷蔵庫']}
        onToggle={onToggle}
        ungroupedLabel="未設定"
        ungroupedValue={UNGROUPED}
      />,
    );
    fireEvent.press(screen.getByText('備蓄'));
    expect(onToggle).toHaveBeenCalledWith('備蓄');
  });
});
