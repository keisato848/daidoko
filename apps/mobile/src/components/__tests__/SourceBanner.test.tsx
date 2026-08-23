/**
 * 取り込み元の帯。ここで守るのは**ステータスバーに被らない**こと
 * （OCR の結果画面で時計の上に被っていた — Pixel 9a・2026-08-23）。
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { SourceBanner, STATUS_BAR_OFFSET } from '../SourceBanner';

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return (style ?? {}) as Record<string, unknown>;
}

describe('SourceBanner', () => {
  it('アイコンと文言を描く', () => {
    render(<SourceBanner icon={<Text>icon</Text>} text="読み取り精度: 高" />);
    expect(screen.getByText('icon')).toBeTruthy();
    expect(screen.getByText('読み取り精度: 高')).toBeTruthy();
  });

  it('ステータスバーの分だけ上を空ける', () => {
    render(<SourceBanner icon={null} text="読み取り精度: 高" />);
    const banner = screen.getByTestId('source-banner');
    expect(flatten(banner.props.style).paddingTop).toBe(STATUS_BAR_OFFSET);
  });
});
