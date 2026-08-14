/**
 * ペイウォールに**利用規約とプライバシーポリシーへの機能するリンク**があること。
 *
 * App Store の審査ガイドライン 3.1.2 は、自動更新サブスクの画面に
 * タイトル・期間・価格に加えて**この 2 つへのリンク**を要求する。文言だけでは足りない。
 * 見た目の整理でうっかり消えると審査で止まるので、描画してリンクを押すところまで固定する。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import PaywallScreen from '../paywall';
import { EULA_URL, PRIVACY_POLICY_URL } from '../../../../src/constants/legal';
import { setLocale } from '../../../../src/i18n';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

describe('ペイウォールの法務リンク', () => {
  let openURL: jest.SpyInstance;

  beforeEach(() => {
    setLocale('ja');
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    openURL.mockRestore();
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
