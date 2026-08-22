/**
 * ダイアログのホスト（`docs/画面設計.md` §7-3）。
 *
 * ここで守るのは **`app/_layout.tsx` に置いてある限り、命令的 API がそのまま画面に出る**こと。
 * ストアとサービスは別々に固めてあるので、繋がっている証拠だけをここで取る。
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { DialogHost } from '../DialogHost';
import { dialog } from '../../services/dialog.service';
import { resetDialogStoreForTesting } from '../../stores/dialog.store';

describe('DialogHost', () => {
  beforeEach(() => {
    resetDialogStoreForTesting();
  });

  it('マウントしていれば dialog.confirm がそのまま画面に出て、押した結果が返る', async () => {
    render(<DialogHost />);

    let resolved: boolean | null = null;
    // enqueue は描画の外で起きるので、act で包んで反映を待つ
    await act(async () => {
      void dialog
        .confirm({ title: 'レシピを削除', message: '元に戻せません。', confirmLabel: '削除' })
        .then((value) => {
          resolved = value;
        });
    });
    expect(screen.getByText('レシピを削除')).toBeTruthy();
    expect(screen.getByText('元に戻せません。')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('削除'));
    });
    expect(resolved).toBe(true);
    expect(screen.queryByText('レシピを削除')).toBeNull();
  });

  it('積み上がったぶんを順に出す', async () => {
    render(<DialogHost />);
    await act(async () => {
      void dialog.alert({ title: '1つ目' });
      void dialog.alert({ title: '2つ目' });
    });
    expect(screen.getByText('1つ目')).toBeTruthy();
    expect(screen.queryByText('2つ目')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('OK'));
    });
    expect(screen.getByText('2つ目')).toBeTruthy();
  });

  it('ホストが外れたら以後の呼び出しは却下側で解決する', async () => {
    const view = render(<DialogHost />);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    view.unmount();

    await expect(dialog.confirm({ title: 'レシピを削除' })).resolves.toBe(false);
    jest.restoreAllMocks();
  });
});
