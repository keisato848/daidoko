/**
 * 買い物リストのチェック済み行（v13・レシート消し込みの受け皿）。
 *
 * レシート取り込みは行を**消さずにチェックを付ける**。画面がそれを見分けられないと
 * 「消し込んだはずの行が普通に並ぶ → タップ → 在庫へ二重に積む」が起きる。
 * ここでは「チェック済みは見た目で分かる」「タップは取り消しになる」を固定する。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ShoppingListScreen from '../shopping';
import { t } from '../../../src/i18n';
import type { ShoppingItem } from '../../../src/services/types';

const mockGetShoppingItems = jest.fn(async () => [] as ShoppingItem[]);
const mockSetChecked = jest.fn(async () => undefined);
const mockMoveToPantry = jest.fn(async () => true);

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));

jest.mock('../../../src/services/pantry.service', () => ({
  moveShoppingItemToPantry: (...args: unknown[]) => mockMoveToPantry(...(args as [])),
  UNGROUPED: '__ungrouped__',
}));

jest.mock('../../../src/services/shopping-list.service', () => ({
  getShoppingItems: (...args: unknown[]) => mockGetShoppingItems(...(args as [])),
  addShoppingItem: jest.fn(async () => null),
  removeShoppingItem: jest.fn(async () => undefined),
  setShoppingItemChecked: (...args: unknown[]) => mockSetChecked(...(args as [])),
  setShoppingItemStore: jest.fn(async () => undefined),
}));

function item(overrides: Partial<ShoppingItem> & { id: string; name: string }): ShoppingItem {
  return {
    amount: null,
    checked: false,
    source: 'manual',
    recipeId: null,
    storeGroup: null,
    createdBy: null,
    checkedBy: null,
    ...overrides,
  };
}

describe('ShoppingListScreen — 消し込み済みの行', () => {
  beforeEach(() => {
    mockGetShoppingItems.mockReset().mockResolvedValue([]);
    mockSetChecked.mockReset().mockResolvedValue(undefined);
    mockMoveToPantry.mockReset().mockResolvedValue(true);
  });

  it('チェック済みの行をタップすると、在庫へ移さずチェックを外す', async () => {
    mockGetShoppingItems.mockResolvedValue([item({ id: 's1', name: '牛乳', checked: true })]);
    render(<ShoppingListScreen />);
    await waitFor(() => expect(screen.getByText('牛乳')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByLabelText(t('pantry.shopping.uncheckLabel', { name: '牛乳' })));
    });

    expect(mockSetChecked).toHaveBeenCalledWith('s1', false);
    expect(mockMoveToPantry).not.toHaveBeenCalled();
  });

  it('未チェックの行はこれまでどおり「買った→在庫へ」', async () => {
    mockGetShoppingItems.mockResolvedValue([item({ id: 's2', name: '卵' })]);
    render(<ShoppingListScreen />);
    await waitFor(() => expect(screen.getByText('卵')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByLabelText(t('pantry.shopping.buyLabel', { name: '卵' })));
    });

    expect(mockMoveToPantry).toHaveBeenCalled();
    expect(mockSetChecked).not.toHaveBeenCalled();
  });

  it('買う場所で絞り込める。未設定は常に覗ける（振り分け忘れを埋もれさせない）', async () => {
    mockGetShoppingItems.mockResolvedValue([
      item({ id: 's1', name: '牛乳', storeGroup: 'スーパー' }),
      item({ id: 's2', name: '洗剤', storeGroup: 'ドラッグストア' }),
      item({ id: 's3', name: 'パン' }),
    ]);
    render(<ShoppingListScreen />);
    await waitFor(() => expect(screen.getByText('牛乳')).toBeTruthy());

    // 「スーパー」はチップと行のバッジの両方に出る。チップ（先に描画される方）を押す
    await act(async () => {
      fireEvent.press(screen.getAllByText('スーパー')[0]);
    });
    expect(screen.getByText('牛乳')).toBeTruthy();
    expect(screen.queryByText('洗剤')).toBeNull();
    expect(screen.queryByText('パン')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText(t('pantry.shopping.storeGroup.ungrouped')));
    });
    expect(screen.getByText('パン')).toBeTruthy();
    expect(screen.queryByText('牛乳')).toBeNull();
  });
});
