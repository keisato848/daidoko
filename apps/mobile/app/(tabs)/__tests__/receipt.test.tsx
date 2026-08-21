/**
 * レシート確認画面（Issue #178）。
 *
 * 固定したいことが2つある。
 *
 * 1. **数量の扱い**（#178-1）。数量は在庫に**合算**されるので、画面が勝手に 1 を入れると
 *    間違いが積もる。「読めた数量は在庫まで運ぶ」「読めなかったものは空欄のまま null で
 *    渡す」「利用者が直した値が優先される」。
 * 2. **経路の選択とフォールバック**（`docs/在庫・レシート設計レビュー.md` §3.4）。
 *    端末内OCRで文字にできたらテキストだけを送り、できなければ写真を送る。
 *    端末内OCRが転んでも**画面にエラーを出さずに**写真経路へ落ちること。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ReceiptScreen from '../receipt';
import { t, tCount } from '../../../src/i18n';

const mockAddPantryItem = jest.fn(async () => null);
const mockInferFromVision = jest.fn();
const mockInferFromText = jest.fn();
const mockRecognizeTextOnDevice = jest.fn();
const mockIsClientOcrAvailable = jest.fn();
const mockDefaultGroupFor = jest.fn(async () => null as string | null);
const mockCheckOffByNames = jest.fn(async () => ({ count: 0, names: [] as string[] }));
const mockMatchPendingByNames = jest.fn(async () => [] as { id: string; name: string }[]);
const mockGetStoreGroupFor = jest.fn(async () => null as string | null);
const mockLearnStoreGroup = jest.fn(async () => undefined);

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }),
}));

jest.mock('../../../src/services/pantry.service', () => ({
  addPantryItem: (...args: unknown[]) => mockAddPantryItem(...(args as [])),
  defaultGroupFor: (...args: unknown[]) => mockDefaultGroupFor(...(args as [])),
}));

jest.mock('../../../src/services/shopping-list.service', () => ({
  checkOffByNames: (...args: unknown[]) => mockCheckOffByNames(...(args as [])),
  matchPendingByNames: (...args: unknown[]) => mockMatchPendingByNames(...(args as [])),
}));

jest.mock('../../../src/services/store-group.service', () => ({
  getStoreGroupFor: (...args: unknown[]) => mockGetStoreGroupFor(...(args as [])),
  getShoppingStoreGroups: async () => [],
  learnStoreGroup: (...args: unknown[]) => mockLearnStoreGroup(...(args as [])),
}));

jest.mock('../../../src/services/receipt-vision.provider', () => ({
  inferReceiptFromVision: (...args: unknown[]) => mockInferFromVision(...(args as [])),
  inferReceiptFromText: (...args: unknown[]) => mockInferFromText(...(args as [])),
}));

jest.mock('../../../src/services/client-ocr.provider', () => ({
  recognizeTextOnDevice: (...args: unknown[]) => mockRecognizeTextOnDevice(...(args as [])),
  isClientOcrAvailable: (...args: unknown[]) => mockIsClientOcrAvailable(...(args as [])),
}));

jest.mock('../../../src/services/photo-capture.service', () => ({
  capturePhoto: async () => ({ localPath: '/tmp/receipt.jpg' }),
  PhotoCaptureCancelledError: class extends Error {},
}));

type Item = { name: string; quantity: number | null; unit: string | null };

function inference(items: Item[], isReceipt = true, store: string | null = null) {
  return { isReceipt, store, items };
}

/** 撮影 → 読み取り完了（確認画面が出る）まで進める。 */
async function capture() {
  render(<ReceiptScreen />);
  await act(async () => {
    fireEvent.press(screen.getByText(t('pantry.receipt.capture')));
  });
}

async function readReceipt(items: Item[]) {
  mockInferFromVision.mockResolvedValue(inference(items));
  await capture();
  await waitFor(() => expect(screen.getByText(t('pantry.receipt.retry'))).toBeTruthy());
}

describe('ReceiptScreen', () => {
  beforeEach(() => {
    mockAddPantryItem.mockClear();
    mockInferFromVision.mockReset();
    mockInferFromText.mockReset();
    // 既定は端末内OCRが無い端末（＝写真をそのまま送る従来の経路）
    mockRecognizeTextOnDevice.mockReset().mockResolvedValue(null);
    mockIsClientOcrAvailable.mockReset().mockResolvedValue(false);
    mockDefaultGroupFor.mockReset().mockResolvedValue(null);
    mockCheckOffByNames.mockReset().mockResolvedValue({ count: 0, names: [] });
    mockMatchPendingByNames.mockReset().mockResolvedValue([]);
    mockGetStoreGroupFor.mockReset().mockResolvedValue(null);
    mockLearnStoreGroup.mockReset().mockResolvedValue(undefined);
  });

  describe('数量の受け渡し', () => {
    it('読み取った数量・単位を在庫にそのまま渡す', async () => {
      await readReceipt([{ name: '牛乳', quantity: 2, unit: '本' }]);

      await act(async () => {
        fireEvent.press(screen.getByText(tCount('pantry.receipt.confirm', 1)));
      });
      expect(mockAddPantryItem).toHaveBeenCalledWith('牛乳', {
        quantity: 2,
        unit: '本',
        groupName: null,
      });
    });

    it('数量が読めなかった品目は空欄で出し、null のまま在庫へ渡す（1 で埋めない）', async () => {
      await readReceipt([{ name: '玉ねぎ', quantity: null, unit: null }]);

      expect(screen.getByLabelText(t('pantry.receipt.quantityLabel')).props.value).toBe('');
      await act(async () => {
        fireEvent.press(screen.getByText(tCount('pantry.receipt.confirm', 1)));
      });
      expect(mockAddPantryItem).toHaveBeenCalledWith('玉ねぎ', {
        quantity: null,
        unit: null,
        groupName: null,
      });
    });

    it('確認画面で直した数量・単位が在庫に入る', async () => {
      await readReceipt([{ name: '豚こま', quantity: 500, unit: 'g' }]);

      fireEvent.changeText(screen.getByLabelText(t('pantry.receipt.quantityLabel')), '300');
      fireEvent.changeText(screen.getByLabelText(t('pantry.receipt.unitLabel')), 'パック');
      await act(async () => {
        fireEvent.press(screen.getByText(tCount('pantry.receipt.confirm', 1)));
      });
      expect(mockAddPantryItem).toHaveBeenCalledWith('豚こま', {
        quantity: 300,
        unit: 'パック',
        groupName: null,
      });
    });
  });

  describe('置き場所と買い物リストの消し込み（v13）', () => {
    it('その品が既に置いてある場所へ足す（未設定に別行を作らない）', async () => {
      mockDefaultGroupFor.mockResolvedValue('冷蔵庫');
      await readReceipt([{ name: '牛乳', quantity: 2, unit: '本' }]);

      await act(async () => {
        fireEvent.press(screen.getByText(tCount('pantry.receipt.confirm', 1)));
      });
      expect(mockAddPantryItem).toHaveBeenCalledWith('牛乳', {
        quantity: 2,
        unit: '本',
        groupName: '冷蔵庫',
      });
    });

    it('買い物リストに当たる品があることを、追加する前に見せる', async () => {
      mockMatchPendingByNames.mockResolvedValue([{ id: 's1', name: '牛乳' }]);
      await readReceipt([{ name: '牛乳', quantity: 2, unit: '本' }]);

      await waitFor(() =>
        expect(screen.getByText(tCount('pantry.receipt.checkOff', 1))).toBeTruthy(),
      );
    });

    it('在庫に追加すると、買った品を買い物リストから消し込む', async () => {
      await readReceipt([{ name: '牛乳', quantity: 2, unit: '本' }]);

      await act(async () => {
        fireEvent.press(screen.getByText(tCount('pantry.receipt.confirm', 1)));
      });
      expect(mockCheckOffByNames).toHaveBeenCalledWith(['牛乳']);
    });

    it('店名が読めたら、覚えている買う場所を出す', async () => {
      mockGetStoreGroupFor.mockResolvedValue('スーパー');
      mockInferFromVision.mockResolvedValue(
        inference([{ name: '牛乳', quantity: 2, unit: '本' }], true, 'だいどこストア'),
      );
      await capture();
      await waitFor(() => expect(screen.getByText(t('pantry.receipt.retry'))).toBeTruthy());

      expect(screen.getByText(/スーパー/)).toBeTruthy();
      expect(mockGetStoreGroupFor).toHaveBeenCalledWith('だいどこストア');
    });
  });

  describe('読み取り経路の選択', () => {
    it('端末内OCRで文字にできたら、写真ではなくテキストだけを送る', async () => {
      mockRecognizeTextOnDevice.mockResolvedValue('だいどこスーパー\n牛乳 2本 ¥398');
      mockInferFromText.mockResolvedValue(inference([{ name: '牛乳', quantity: 2, unit: '本' }]));

      await capture();
      await waitFor(() => expect(screen.getByText(t('pantry.receipt.retry'))).toBeTruthy());
      expect(mockInferFromText).toHaveBeenCalledWith({
        ocrText: 'だいどこスーパー\n牛乳 2本 ¥398',
      });
      expect(mockInferFromVision).not.toHaveBeenCalled();
    });

    it('端末内OCRが使えない・読めないときは写真を送る', async () => {
      mockRecognizeTextOnDevice.mockResolvedValue(null);
      await readReceipt([{ name: '牛乳', quantity: null, unit: null }]);

      expect(mockInferFromText).not.toHaveBeenCalled();
      expect(mockInferFromVision).toHaveBeenCalledWith({
        localPath: '/tmp/receipt.jpg',
        mimeType: 'image/jpeg',
      });
    });

    it('テキストからレシートと判定できなければ写真経路をやり直す', async () => {
      mockRecognizeTextOnDevice.mockResolvedValue('��� ??? ###');
      mockInferFromText.mockResolvedValue(inference([], false));
      mockInferFromVision.mockResolvedValue(
        inference([{ name: '卵', quantity: 1, unit: 'パック' }]),
      );

      await capture();
      await waitFor(() => expect(screen.getByText(t('pantry.receipt.retry'))).toBeTruthy());
      expect(mockInferFromVision).toHaveBeenCalled();
      expect(screen.getByDisplayValue('卵')).toBeTruthy();
    });

    it('テキストからは1件も取れなかったときも写真経路をやり直す', async () => {
      mockRecognizeTextOnDevice.mockResolvedValue('小計 1,280\n合計 1,382');
      mockInferFromText.mockResolvedValue(inference([]));
      mockInferFromVision.mockResolvedValue(
        inference([{ name: '卵', quantity: null, unit: null }]),
      );

      await capture();
      await waitFor(() => expect(screen.getByText(t('pantry.receipt.retry'))).toBeTruthy());
      expect(mockInferFromVision).toHaveBeenCalled();
    });

    it('写真経路でもレシートでなければ、その旨だけを出す（生のエラーを出さない）', async () => {
      mockInferFromVision.mockResolvedValue(inference([], false));

      await capture();
      await waitFor(() => expect(screen.getByText(t('pantry.receipt.notRecognized'))).toBeTruthy());
    });
  });

  describe('送信するものの開示', () => {
    it('端末内OCRが使えるときは「文字だけを送る／読めなければ写真」と伝える', async () => {
      mockIsClientOcrAvailable.mockResolvedValue(true);
      render(<ReceiptScreen />);
      await waitFor(() =>
        expect(screen.getByText(t('pantry.receipt.disclosureOnDevice'))).toBeTruthy(),
      );
    });

    it('端末内OCRが無いときは写真を送ることを伝える', async () => {
      render(<ReceiptScreen />);
      await waitFor(() => expect(screen.getByText(t('pantry.receipt.disclosure'))).toBeTruthy());
    });
  });
});
