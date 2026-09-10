/**
 * バナー広告のゲート。ここで守るのは 2 点 —
 * **ユニット ID が空のプラットフォームでは絶対に出さない**。
 * 空をプロバイダに渡すとテスト ID にフォールバックし、本番ビルドに
 * テスト広告が出る（AdMob ポリシー違反 = アカウント停止リスク）。
 * **UMP の同意が無いときは絶対に出さない**（2026-09-06・Issue #295）。
 * リワードとアプリ起動は元から確認していたのに、バナーだけ抜けていた。
 * EEA / 英国で同意前・拒否後に広告をリクエストすると Google の
 * EU ユーザー同意ポリシー違反になる。
 */
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { canRequestAds } from '../../services/ads-consent.service';
import { AdBanner, shouldShowBanner } from '../AdBanner';

jest.mock('../../services/ads-consent.service', () => ({ canRequestAds: jest.fn() }));

const mockCanRequestAds = canRequestAds as jest.MockedFunction<typeof canRequestAds>;

/** 出す側の条件を全部満たした状態。各テストは 1 つだけ崩す。 */
const ALLOWED = { enabled: true, unitId: 'ca-app-pub-x/1', premium: false, consented: true };

describe('shouldShowBanner', () => {
  it('ユニット ID が空なら、広告有効ビルドでも出さない', () => {
    expect(shouldShowBanner({ ...ALLOWED, unitId: '' })).toBe(false);
  });

  it('広告無効ビルドでは出さない', () => {
    expect(shouldShowBanner({ ...ALLOWED, enabled: false })).toBe(false);
  });

  it('プレミアムには出さない', () => {
    expect(shouldShowBanner({ ...ALLOWED, premium: true })).toBe(false);
  });

  it('UMP の同意が無いときは出さない', () => {
    expect(shouldShowBanner({ ...ALLOWED, consented: false })).toBe(false);
  });

  it('4 条件が揃ったときだけ出す', () => {
    expect(shouldShowBanner(ALLOWED)).toBe(true);
  });
});

describe('AdBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanRequestAds.mockResolvedValue(true);
  });

  it('テスト環境（ADMOB 無効・unit 未設定）では何も描画しない', () => {
    const tree = render(<AdBanner />);
    expect(tree.toJSON()).toBeNull();
  });

  it('マウント時に同意状態を取りに行く（リワード頼みにしない）', async () => {
    render(<AdBanner />);
    // 初回起動ではアプリ起動広告が 24 時間の猶予で return するため、
    // バナー自身が呼ばないと gatherConsent が一度も走らない経路ができる
    await waitFor(() => expect(mockCanRequestAds).toHaveBeenCalledTimes(1));
  });

  it('同意の判定が失敗しても描画しない（例外を投げない）', async () => {
    mockCanRequestAds.mockRejectedValue(new Error('native boom'));
    const tree = render(<AdBanner />);
    await waitFor(() => expect(mockCanRequestAds).toHaveBeenCalled());
    expect(tree.toJSON()).toBeNull();
  });
});
