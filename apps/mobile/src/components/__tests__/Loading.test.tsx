import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { Loading } from '../Loading';

describe('Loading', () => {
  it('インジケーターを表示する', () => {
    render(<Loading />);
    expect(screen.getByTestId('loading-indicator')).toBeTruthy();
  });

  it('message を表示する', () => {
    render(<Loading message="読み込んでいます" />);
    expect(screen.getByText('読み込んでいます')).toBeTruthy();
  });

  it('message がなければテキストを表示しない', () => {
    render(<Loading />);
    expect(screen.queryByText('読み込んでいます')).toBeNull();
  });
});
