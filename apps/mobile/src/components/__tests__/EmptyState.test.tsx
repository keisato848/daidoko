import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('title を表示する', () => {
    render(<EmptyState title="レシピがありません" />);
    expect(screen.getByText('レシピがありません')).toBeTruthy();
  });

  it('icon を表示する', () => {
    render(<EmptyState icon="🍽️" title="空です" />);
    expect(screen.getByText('🍽️')).toBeTruthy();
  });

  it('message を表示する', () => {
    render(<EmptyState title="空です" message="レシピを追加してください" />);
    expect(screen.getByText('レシピを追加してください')).toBeTruthy();
  });

  it('message がなければ表示しない', () => {
    render(<EmptyState title="空です" />);
    expect(screen.queryByText('レシピを追加してください')).toBeNull();
  });

  it('actionLabel と onAction が渡されたときボタンを表示する', () => {
    const onAction = jest.fn();
    render(<EmptyState title="空です" actionLabel="追加する" onAction={onAction} />);
    expect(screen.getByText('追加する')).toBeTruthy();
  });

  it('ボタンを押すと onAction が呼ばれる', () => {
    const onAction = jest.fn();
    render(<EmptyState title="空です" actionLabel="追加する" onAction={onAction} />);
    fireEvent.press(screen.getByText('追加する'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('onAction がなければボタンを表示しない', () => {
    render(<EmptyState title="空です" actionLabel="追加する" />);
    expect(screen.queryByText('追加する')).toBeNull();
  });
});
