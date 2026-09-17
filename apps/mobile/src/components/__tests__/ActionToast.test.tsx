/**
 * ActionToast コンポーネントのテスト。
 *
 * - store に payload があれば表示される
 * - store が空なら何も表示しない
 * - action ボタンがあれば押せる
 * - 自動消去の既定: action なし → 4 秒、action あり → 8 秒
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { useActionToastStore } from '../../stores/action-toast.store';
import { ActionToast } from '../ActionToast';

beforeEach(() => {
  // ストアを初期状態に戻す
  useActionToastStore.setState({ current: null });
});

describe('ActionToast', () => {
  it('current が null のとき何も表示しない', () => {
    render(<ActionToast />);
    expect(screen.queryByText(/.+/)).toBeNull();
  });

  it('current にメッセージがあれば表示する', () => {
    useActionToastStore.getState().show({ message: '買い物リストに追加しました' });
    render(<ActionToast />);
    expect(screen.getByText('買い物リストに追加しました')).toBeTruthy();
  });

  it('action ボタンがあればテキストを表示する', () => {
    useActionToastStore.getState().show({
      message: '追加しました',
      action: { label: '取り消し', onPress: jest.fn() },
    });
    render(<ActionToast />);
    expect(screen.getByText('取り消し')).toBeTruthy();
  });

  it('action ボタンを押すと onPress が呼ばれる', () => {
    const onPress = jest.fn();
    useActionToastStore.getState().show({
      message: '追加しました',
      action: { label: '取り消し', onPress },
    });
    render(<ActionToast />);
    fireEvent.press(screen.getByText('取り消し'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('action なしの既定 durationMs は 4_000', () => {
    jest.useFakeTimers();
    useActionToastStore.getState().show({ message: 'テスト' });
    render(<ActionToast />);

    // 4 秒 + fade-out 200ms では消えていないが、dismiss は呼ばれる
    act(() => jest.advanceTimersByTime(4_000 + 300));
    expect(useActionToastStore.getState().current).toBeNull();
    jest.useRealTimers();
  });

  it('action ありの既定 durationMs は 8_000', () => {
    jest.useFakeTimers();
    useActionToastStore.getState().show({
      message: 'テスト',
      action: { label: '取り消し', onPress: jest.fn() },
    });
    render(<ActionToast />);

    // 4 秒では消えない
    act(() => jest.advanceTimersByTime(4_000 + 300));
    expect(useActionToastStore.getState().current).not.toBeNull();

    // 8 秒 + fade-out で消える
    act(() => jest.advanceTimersByTime(4_000 + 300));
    expect(useActionToastStore.getState().current).toBeNull();
    jest.useRealTimers();
  });

  it('durationMs を明示すればそちらに従う', () => {
    jest.useFakeTimers();
    useActionToastStore.getState().show({ message: 'テスト', durationMs: 1_000 });
    render(<ActionToast />);

    act(() => jest.advanceTimersByTime(1_000 + 300));
    expect(useActionToastStore.getState().current).toBeNull();
    jest.useRealTimers();
  });
});
