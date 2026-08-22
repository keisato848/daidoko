/**
 * ダイアログの見た目（`docs/画面設計.md` §7-2）。
 *
 * ここで守るのは**ボタンの並びと押したときの添字**。並びが崩れると
 * 「キャンセルのつもりが削除」になるので、規約（左キャンセル / 3つ以上は縦積みで
 * キャンセル最下段）をテストで固定する。
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { AppDialog, type DialogButton } from '../AppDialog';
import { Colors } from '../../constants/theme';

const OK: readonly DialogButton[] = [{ label: 'OK', tone: 'primary' }];
const CONFIRM: readonly DialogButton[] = [
  { label: 'キャンセル', tone: 'default' },
  { label: '削除', tone: 'destructive' },
];

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return (style ?? {}) as Record<string, unknown>;
}

/** ボタン（Pressable）の style。Text の parent はホスト要素なので role で引く。 */
function buttonStyle(name: string): Record<string, unknown> {
  return flatten(screen.getByRole('button', { name }).props.style);
}

describe('AppDialog', () => {
  it('タイトル・本文・ボタンを表示する', () => {
    render(
      <AppDialog
        layout="card"
        title="保存しました"
        message="API キーを保存しました。"
        buttons={OK}
        onPress={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(screen.getByText('保存しました')).toBeTruthy();
    expect(screen.getByText('API キーを保存しました。')).toBeTruthy();
    expect(screen.getByText('OK')).toBeTruthy();
  });

  it('本文が無くても描画できる', () => {
    render(
      <AppDialog
        layout="card"
        title="通信できません"
        buttons={OK}
        onPress={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(screen.getByText('通信できません')).toBeTruthy();
  });

  it('押されたボタンの添字を返す', () => {
    const onPress = jest.fn();
    render(
      <AppDialog
        layout="sheet"
        title="レシピを削除"
        buttons={CONFIRM}
        onPress={onPress}
        onDismiss={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByText('削除'));
    expect(onPress).toHaveBeenCalledWith(1);

    fireEvent.press(screen.getByText('キャンセル'));
    expect(onPress).toHaveBeenLastCalledWith(0);
  });

  it('2 つまでは横並び、3 つ以上は縦積みにする', () => {
    const { rerender } = render(
      <AppDialog
        layout="sheet"
        title="確認"
        buttons={CONFIRM}
        onPress={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    // 横並びのときだけ各ボタンが flex:1 で幅を分け合う
    expect(buttonStyle('削除').flex).toBe(1);

    rerender(
      <AppDialog
        layout="sheet"
        title="単位系"
        buttons={[
          { label: 'メートル法', tone: 'default' },
          { label: 'ヤード・ポンド法', tone: 'default' },
          { label: 'キャンセル', tone: 'default' },
        ]}
        onPress={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    const stacked = buttonStyle('メートル法');
    expect(stacked.flex).toBeUndefined();
    expect(stacked.width).toBe('100%');
  });

  it('破壊的なボタンだけ赤くする', () => {
    render(
      <AppDialog
        layout="sheet"
        title="レシピを削除"
        buttons={CONFIRM}
        onPress={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(buttonStyle('削除').backgroundColor).toBe(Colors.dangerBg);
    expect(flatten(screen.getByText('削除').props.style).color).toBe(Colors.danger);
    expect(buttonStyle('キャンセル').backgroundColor).toBeUndefined();
  });

  it('カードは背景タップで onDismiss を呼ぶ', () => {
    const onDismiss = jest.fn();
    render(
      <AppDialog
        layout="card"
        title="通信できません"
        buttons={OK}
        onPress={jest.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(screen.getByLabelText('閉じる'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
