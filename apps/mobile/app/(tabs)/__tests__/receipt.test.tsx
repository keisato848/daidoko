/**
 * レシート確認画面（Issue #178-1）。
 *
 * 数量は在庫に**合算**されるので、画面が勝手に 1 を入れると間違いが積もる。
 * 「読めた数量は在庫まで運ぶ」「読めなかったものは空欄のまま null で渡す」
 * 「利用者が直した値が優先される」の3つを固定する。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ReceiptScreen from '../receipt';
import { t, tCount } from '../../../src/i18n';

const mockAddPantryItem = jest.fn(async () => null);
const mockInferReceipt = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }),
}));

jest.mock('../../../src/services/pantry.service', () => ({
  addPantryItem: (...args: unknown[]) => mockAddPantryItem(...(args as [])),
}));

jest.mock('../../../src/services/receipt-vision.provider', () => ({
  inferReceiptFromVision: (...args: unknown[]) => mockInferReceipt(...(args as [])),
}));

// 端末内OCRは SDK 54 で外れているので、常にクラウド経路（本番と同じ）
jest.mock('../../../src/services/client-ocr.provider', () => ({
  createClientOcrRecognizer: () => null,
}));

jest.mock('../../../src/services/photo-capture.service', () => ({
  capturePhoto: async () => ({ localPath: '/tmp/receipt.jpg' }),
  PhotoCaptureCancelledError: class extends Error {},
}));

async function readReceipt(
  items: { name: string; quantity: number | null; unit: string | null }[],
) {
  mockInferReceipt.mockResolvedValue({ isReceipt: true, store: null, items });
  render(<ReceiptScreen />);
  await act(async () => {
    fireEvent.press(screen.getByText(t('pantry.receipt.capture')));
  });
  await waitFor(() => expect(screen.getByText(t('pantry.receipt.retry'))).toBeTruthy());
}

describe('ReceiptScreen', () => {
  beforeEach(() => {
    mockAddPantryItem.mockClear();
    mockInferReceipt.mockReset();
  });

  it('読み取った数量・単位を在庫にそのまま渡す', async () => {
    await readReceipt([{ name: '牛乳', quantity: 2, unit: '本' }]);

    await act(async () => {
      fireEvent.press(screen.getByText(tCount('pantry.receipt.confirm', 1)));
    });
    expect(mockAddPantryItem).toHaveBeenCalledWith('牛乳', { quantity: 2, unit: '本' });
  });

  it('数量が読めなかった品目は空欄で出し、null のまま在庫へ渡す（1 で埋めない）', async () => {
    await readReceipt([{ name: '玉ねぎ', quantity: null, unit: null }]);

    expect(screen.getByLabelText(t('pantry.receipt.quantityLabel')).props.value).toBe('');
    await act(async () => {
      fireEvent.press(screen.getByText(tCount('pantry.receipt.confirm', 1)));
    });
    expect(mockAddPantryItem).toHaveBeenCalledWith('玉ねぎ', { quantity: null, unit: null });
  });

  it('確認画面で直した数量・単位が在庫に入る', async () => {
    await readReceipt([{ name: '豚こま', quantity: 500, unit: 'g' }]);

    fireEvent.changeText(screen.getByLabelText(t('pantry.receipt.quantityLabel')), '300');
    fireEvent.changeText(screen.getByLabelText(t('pantry.receipt.unitLabel')), 'パック');
    await act(async () => {
      fireEvent.press(screen.getByText(tCount('pantry.receipt.confirm', 1)));
    });
    expect(mockAddPantryItem).toHaveBeenCalledWith('豚こま', { quantity: 300, unit: 'パック' });
  });
});
