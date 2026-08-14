/**
 * ペイウォールの購入まわり。2 つのことを固定する。
 *
 * 1. **利用規約とプライバシーポリシーへの機能するリンク**があること。
 *    App Store の審査ガイドライン 3.1.2 は、自動更新サブスクの画面に
 *    タイトル・期間・価格に加えてこの 2 つへのリンクを要求する。文言だけでは足りない。
 * 2. **課金が使えないプラットフォームでは購入 UI を出さない**こと。
 *    有料化は iOS 先行で Android は据え置きのため、買えないのに購入ボタンが出ると
 *    押した先で必ず失敗する。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import PaywallScreen from '../paywall';
import { EULA_URL, PRIVACY_POLICY_URL } from '../../../../src/constants/legal';
import { setLocale } from '../../../../src/i18n';
import * as entitlement from '../../../../src/services/entitlement.service';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

describe('ペイウォールの法務リンク', () => {
  let openURL: jest.SpyInstance;
  let configured: jest.SpyInstance;

  beforeEach(() => {
    setLocale('ja');
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    configured = jest.spyOn(entitlement, 'isEntitlementConfigured').mockReturnValue(true);
  });

  afterEach(() => {
    openURL.mockRestore();
    configured.mockRestore();
  });

  it('利用規約のリンクが Apple 標準 EULA を開く', async () => {
    render(<PaywallScreen />);
    const link = await screen.findByText('利用規約');
    fireEvent.press(link);
    await waitFor(() => expect(openURL).toHaveBeenCalledWith(EULA_URL));
  });

  it('プライバシーポリシーのリンクが公開中のポリシーを開く', async () => {
    render(<PaywallScreen />);
    const link = await screen.findByText('プライバシーポリシー');
    fireEvent.press(link);
    await waitFor(() => expect(openURL).toHaveBeenCalledWith(PRIVACY_POLICY_URL));
  });

  it('自動更新の条件も併記されている（リンクだけでは要件を満たさない）', async () => {
    render(<PaywallScreen />);
    expect(await screen.findByText(/自動更新されます/)).toBeTruthy();
  });
});

describe('課金が使えないプラットフォーム', () => {
  let configured: jest.SpyInstance;

  beforeEach(() => {
    setLocale('ja');
    configured = jest.spyOn(entitlement, 'isEntitlementConfigured').mockReturnValue(false);
  });

  afterEach(() => {
    configured.mockRestore();
  });

  it('購入ボタン・価格・復元を出さない', async () => {
    render(<PaywallScreen />);
    await screen.findByText('AIレシピをもっと使う');
    expect(screen.queryByText('プレミアムを始める')).toBeNull();
    expect(screen.queryByText('購入を復元する')).toBeNull();
    expect(screen.queryByText('月額サブスク')).toBeNull();
  });

  it('プレミアムの語で見出しを出さない（買えない商品を宣伝しない）', async () => {
    render(<PaywallScreen />);
    expect(await screen.findByText('AIレシピをもっと使う')).toBeTruthy();
    expect(screen.queryByText('DAIDOKO プレミアム')).toBeNull();
  });

  it('サブスク前提の法務リンクも出さない', async () => {
    render(<PaywallScreen />);
    await screen.findByText('AIレシピをもっと使う');
    expect(screen.queryByText('利用規約')).toBeNull();
    expect(screen.queryByText('プライバシーポリシー')).toBeNull();
  });
});
