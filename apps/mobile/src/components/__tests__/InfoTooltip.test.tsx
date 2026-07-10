import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { InfoTooltip } from '../InfoTooltip';

describe('InfoTooltip', () => {
  it('ラベルを表示し、詳細は初期状態で非表示', () => {
    render(<InfoTooltip label="保存場所" detail="端末内に暗号化して保存します。" />);
    expect(screen.getByText('保存場所')).toBeTruthy();
    expect(screen.queryByText('端末内に暗号化して保存します。')).toBeNull();
  });

  it('タップすると詳細が表示される', () => {
    render(<InfoTooltip label="保存場所" detail="端末内に暗号化して保存します。" />);
    fireEvent.press(screen.getByText('保存場所'));
    expect(screen.getByText('端末内に暗号化して保存します。')).toBeTruthy();
  });

  it('再度タップすると詳細が閉じる', () => {
    render(<InfoTooltip label="保存場所" detail="端末内に暗号化して保存します。" />);
    const label = screen.getByText('保存場所');
    fireEvent.press(label);
    expect(screen.getByText('端末内に暗号化して保存します。')).toBeTruthy();
    fireEvent.press(label);
    expect(screen.queryByText('端末内に暗号化して保存します。')).toBeNull();
  });
});
