import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { TagChip } from '../TagChip';

describe('TagChip', () => {
  it('ラベルテキストを表示する', () => {
    render(<TagChip label="肉" />);
    expect(screen.getByText('肉')).toBeTruthy();
  });

  it('日本語ラベルを正しく表示する', () => {
    render(<TagChip label="ご飯もの" />);
    expect(screen.getByText('ご飯もの')).toBeTruthy();
  });

  it('長いラベルでも表示する', () => {
    render(<TagChip label="クリスマスディナー" />);
    expect(screen.getByText('クリスマスディナー')).toBeTruthy();
  });
});
