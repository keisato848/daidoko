/**
 * ホームから在庫ループへの入口（2026-08-21 の導線確認）。
 *
 * 在庫 → 作れるレシピ → 足りない材料 → 買い物リスト は繋がっていたが、
 * 起点が下タブの「在庫」だけで、ホームからは存在に気づけなかった。
 *
 * **在庫に何か入っているときだけ**出す。0 件で出しても押した先が空になるだけで、
 * 在庫を使っていない人のホームに要らないものが増える。
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import HomeScreen from '../index';
import { t } from '../../../src/i18n';

const mockGetInStock = jest.fn(async () => [] as string[]);
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));

jest.mock('../../../src/services/pantry.service', () => ({
  getInStockNormalizedNames: (...args: unknown[]) => mockGetInStock(...(args as [])),
}));

jest.mock('../../../src/services/timeline.service', () => ({
  getTimeline: jest.fn(async () => []),
}));

jest.mock('../../../src/services/recipe.service', () => ({
  getWantToCookRecipes: jest.fn(async () => []),
}));

jest.mock('../../../src/services/cooking-log.service', () => ({
  deleteCookingLog: jest.fn(async () => undefined),
}));

describe('HomeScreen — 在庫ループへの入口', () => {
  beforeEach(() => {
    mockGetInStock.mockReset().mockResolvedValue([]);
    mockPush.mockReset();
  });

  it('在庫が空なら出さない（使っていない人のホームを変えない）', async () => {
    render(<HomeScreen />);
    // 「撮る」は主役ボタンと空状態の CTA の 2 か所に出るので getAllByText で待つ
    await waitFor(() => expect(screen.getAllByText(t('home.capture')).length).toBeGreaterThan(0));

    expect(screen.queryByText(t('home.cookable'))).toBeNull();
  });

  it('在庫に何か入っていれば出す', async () => {
    mockGetInStock.mockResolvedValue(['たまご', 'ぎゅうにゅう']);
    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText(t('home.cookable'))).toBeTruthy());
  });

  it('在庫の読み取りに失敗しても、ホームは出る（入口が消えるだけ）', async () => {
    mockGetInStock.mockRejectedValue(new Error('db closed'));
    render(<HomeScreen />);

    // 「撮る」は主役ボタンと空状態の CTA の 2 か所に出るので getAllByText で待つ
    await waitFor(() => expect(screen.getAllByText(t('home.capture')).length).toBeGreaterThan(0));
    expect(screen.queryByText(t('home.cookable'))).toBeNull();
  });
});
