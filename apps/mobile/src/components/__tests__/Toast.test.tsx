import { act, render, screen } from '@testing-library/react-native';
import React from 'react';

import { Toast } from '../Toast';

describe('Toast', () => {
  it('visible=true のときメッセージを表示する', () => {
    render(<Toast message="保存しました" visible={true} onDismiss={jest.fn()} />);
    expect(screen.getByText('保存しました')).toBeTruthy();
  });

  it('visible=false のとき何も表示しない', () => {
    render(<Toast message="保存しました" visible={false} onDismiss={jest.fn()} />);
    expect(screen.queryByText('保存しました')).toBeNull();
  });

  it('duration 後に onDismiss が呼ばれる', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(<Toast message="完了" visible={true} onDismiss={onDismiss} duration={100} />);
    // Animated.sequence: fade-in(200ms) + delay(duration) + fade-out(200ms)
    // duration=100 なので合計 400ms を超えるまで進める
    act(() => jest.advanceTimersByTime(600));
    // Animated が useNativeDriver でも JS タイマーにフォールバックするため呼ばれる
    expect(onDismiss).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('visible=false の場合は onDismiss が呼ばれない', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(<Toast message="完了" visible={false} onDismiss={onDismiss} />);
    act(() => jest.advanceTimersByTime(5000));
    expect(onDismiss).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
