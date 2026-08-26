/**
 * 在庫の置き場所・賞味期限（v13）。
 *
 * 置き場所も期限も**任意**なので、使わない人の画面が変わらないことが第一条件。
 * そのうえで「絞り込みで未設定が覗ける」「期限は書式が違えば保存しない」を固定する。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import PantryScreen from '../pantry';
import { t } from '../../../src/i18n';
import type { PantryItem } from '../../../src/services/types';

const mockGetPantryItems = jest.fn(async () => [] as PantryItem[]);
const mockUpdatePantryItem = jest.fn(async () => undefined);
const mockAddPantryItem = jest.fn(async () => null);

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), canGoBack: () => false }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));

jest.mock('../../../src/services/pantry.service', () => ({
  getPantryItems: (...args: unknown[]) => mockGetPantryItems(...(args as [])),
  updatePantryItem: (...args: unknown[]) => mockUpdatePantryItem(...(args as [])),
  addPantryItem: (...args: unknown[]) => mockAddPantryItem(...(args as [])),
  removePantryItem: jest.fn(async () => undefined),
  UNGROUPED: '__ungrouped__',
}));

jest.mock('../../../src/services/low-stock.service', () => ({
  checkAndNotifyLowStock: jest.fn(async () => undefined),
}));

jest.mock('../../../src/services/notification.service', () => ({
  ensureNotificationPermission: jest.fn(async () => true),
}));

function item(overrides: Partial<PantryItem> & { id: string; name: string }): PantryItem {
  return {
    quantity: 1,
    unit: null,
    lowStockThreshold: null,
    janCode: null,
    groupName: null,
    expiresOn: null,
    ...overrides,
  };
}

describe('PantryScreen — 置き場所と賞味期限', () => {
  beforeEach(() => {
    mockGetPantryItems.mockReset().mockResolvedValue([]);
    mockUpdatePantryItem.mockReset().mockResolvedValue(undefined);
    mockAddPantryItem.mockReset().mockResolvedValue(null);
  });

  it('置き場所を一度も使っていなければ、チップを出さない（画面を変えない）', async () => {
    mockGetPantryItems.mockResolvedValue([item({ id: 'p1', name: '玉ねぎ' })]);
    render(<PantryScreen />);
    await waitFor(() => expect(screen.getByText('玉ねぎ')).toBeTruthy());

    expect(screen.queryByText(t('pantry.group.all'))).toBeNull();
    expect(screen.queryByText(t('pantry.group.ungrouped'))).toBeNull();
  });

  it('置き場所で絞り込める。未設定も覗ける', async () => {
    mockGetPantryItems.mockResolvedValue([
      item({ id: 'p1', name: '米', groupName: '備蓄' }),
      item({ id: 'p2', name: '牛乳', groupName: '冷蔵庫' }),
      item({ id: 'p3', name: '玉ねぎ' }),
    ]);
    render(<PantryScreen />);
    await waitFor(() => expect(screen.getByText('米')).toBeTruthy());

    // 「備蓄」はチップと行のバッジの両方に出る。チップ（先に描画される方）を押す
    await act(async () => {
      fireEvent.press(screen.getAllByText('備蓄')[0]);
    });
    expect(screen.getByText('米')).toBeTruthy();
    expect(screen.queryByText('牛乳')).toBeNull();
    expect(screen.queryByText('玉ねぎ')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText(t('pantry.group.ungrouped')));
    });
    expect(screen.getByText('玉ねぎ')).toBeTruthy();
    expect(screen.queryByText('米')).toBeNull();
  });

  it('賞味期限は YYYY-MM-DD で保存する', async () => {
    mockGetPantryItems.mockResolvedValue([item({ id: 'p1', name: '牛乳' })]);
    render(<PantryScreen />);
    await waitFor(() => expect(screen.getByText('牛乳')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByLabelText(t('pantry.group.editLabel')));
    });
    fireEvent.changeText(screen.getByPlaceholderText(t('pantry.expiry.placeholder')), '2026-09-30');
    await act(async () => {
      fireEvent.press(screen.getByLabelText(t('common.save')));
    });

    expect(mockUpdatePantryItem).toHaveBeenCalledWith('p1', { expiresOn: '2026-09-30' });
  });

  it('書式が違う日付は保存せず、直し方を出す（黙って捨てない）', async () => {
    mockGetPantryItems.mockResolvedValue([item({ id: 'p1', name: '牛乳' })]);
    render(<PantryScreen />);
    await waitFor(() => expect(screen.getByText('牛乳')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByLabelText(t('pantry.group.editLabel')));
    });
    fireEvent.changeText(screen.getByPlaceholderText(t('pantry.expiry.placeholder')), '9/30');
    await act(async () => {
      fireEvent.press(screen.getByLabelText(t('common.save')));
    });

    expect(mockUpdatePantryItem).not.toHaveBeenCalled();
    expect(screen.getByText(t('pantry.expiry.invalid'))).toBeTruthy();
  });

  it('空欄で保存すると期限を消す（任意入力なので消せる）', async () => {
    mockGetPantryItems.mockResolvedValue([
      item({ id: 'p1', name: '牛乳', expiresOn: '2026-09-30' }),
    ]);
    render(<PantryScreen />);
    await waitFor(() => expect(screen.getByText('牛乳')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByLabelText(t('pantry.group.editLabel')));
    });
    fireEvent.changeText(screen.getByPlaceholderText(t('pantry.expiry.placeholder')), '');
    await act(async () => {
      fireEvent.press(screen.getByLabelText(t('common.save')));
    });

    expect(mockUpdatePantryItem).toHaveBeenCalledWith('p1', { expiresOn: null });
  });

  it('絞り込み中に足した品は、その置き場所へ入る（足した直後に消えない）', async () => {
    mockGetPantryItems.mockResolvedValue([item({ id: 'p1', name: '米', groupName: '備蓄' })]);
    render(<PantryScreen />);
    await waitFor(() => expect(screen.getByText('米')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getAllByText('備蓄')[0]);
    });
    fireEvent.changeText(screen.getByPlaceholderText(t('pantry.addPlaceholder')), 'パスタ');
    await act(async () => {
      fireEvent.press(screen.getByLabelText(t('common.add')));
    });

    expect(mockAddPantryItem).toHaveBeenCalledWith('パスタ', {
      quantity: null,
      unit: null,
      groupName: '備蓄',
    });
  });
});
