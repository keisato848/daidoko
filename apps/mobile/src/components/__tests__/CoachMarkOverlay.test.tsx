/**
 * コーチマークの吹き出しの配置。
 *
 * ここで守るのは**文言の長さに関係なく、吹き出しが画面の外に出ない**こと。
 * 「下に 180px 空いていれば下」の固定値だった頃、4 行の吹き出しで「はじめる」が
 * 画面外に押し出された（追加画面の 3 枚目・Pixel 9a）。
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { bubblePlacement, CoachMarkOverlay } from '../CoachMarkOverlay';

const SCREEN_H = 2400;

describe('bubblePlacement', () => {
  it('対象が上半分なら、その下に出す', () => {
    const rect = { x: 40, y: 400, width: 1000, height: 200 };
    expect(bubblePlacement(rect, SCREEN_H)).toEqual({ top: 400 + 200 + 16 });
  });

  it('対象が下半分なら、その上に出す（下に少し空いていても）', () => {
    // 以前の判定（y + height + 180 < screenH）では「下」になっていた位置
    const rect = { x: 40, y: 1700, width: 1000, height: 240 };
    expect(bubblePlacement(rect, SCREEN_H)).toEqual({ bottom: SCREEN_H - 1700 + 16 });
  });

  it('中心で判定する（上端が上半分でも、中心が下半分なら上）', () => {
    const rect = { x: 40, y: 1100, width: 1000, height: 400 }; // 中心 1300 > 1200
    expect(bubblePlacement(rect, SCREEN_H)).toEqual({ bottom: SCREEN_H - 1100 + 16 });
  });

  it('対象が無ければ中央やや上', () => {
    expect(bubblePlacement(null, SCREEN_H)).toEqual({ top: SCREEN_H * 0.38 });
  });
});

describe('CoachMarkOverlay', () => {
  it('タイトル・本文・進捗を描き、最後の 1 枚は「はじめる」になる', () => {
    render(
      <CoachMarkOverlay
        visible
        step={{ key: 'manual', title: '手動で', text: '一から入力', rect: null }}
        index={2}
        total={3}
        onNext={jest.fn()}
        onSkip={jest.fn()}
      />,
    );
    expect(screen.getByText('手動で')).toBeTruthy();
    expect(screen.getByText('一から入力')).toBeTruthy();
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(screen.getByText('はじめる')).toBeTruthy();
    expect(screen.queryByText('スキップ')).toBeNull();
  });
});
