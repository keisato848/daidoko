/**
 * バナー広告のゲート。ここで守るのは 1 点 —
 * **ユニット ID が空のプラットフォームでは絶対に出さない**。
 * 空をプロバイダに渡すとテスト ID にフォールバックし、本番ビルドに
 * テスト広告が出る（AdMob ポリシー違反 = アカウント停止リスク）。
 */
import { render } from '@testing-library/react-native';
import React from 'react';

import { AdBanner, shouldShowBanner } from '../AdBanner';

describe('shouldShowBanner', () => {
  it('ユニット ID が空なら、広告有効ビルドでも出さない', () => {
    expect(shouldShowBanner({ enabled: true, unitId: '', premium: false })).toBe(false);
  });

  it('広告無効ビルドでは出さない', () => {
    expect(shouldShowBanner({ enabled: false, unitId: 'ca-app-pub-x/1', premium: false })).toBe(
      false,
    );
  });

  it('プレミアムには出さない', () => {
    expect(shouldShowBanner({ enabled: true, unitId: 'ca-app-pub-x/1', premium: true })).toBe(
      false,
    );
  });

  it('3 条件が揃ったときだけ出す', () => {
    expect(shouldShowBanner({ enabled: true, unitId: 'ca-app-pub-x/1', premium: false })).toBe(
      true,
    );
  });
});

describe('AdBanner', () => {
  it('テスト環境（ADMOB 無効・unit 未設定）では何も描画しない', () => {
    const tree = render(<AdBanner />);
    expect(tree.toJSON()).toBeNull();
  });
});
