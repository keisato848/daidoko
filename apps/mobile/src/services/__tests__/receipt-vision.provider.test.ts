import { normalizeReceiptRaw } from '../receipt-vision.provider';

describe('normalizeReceiptRaw', () => {
  it('品目名を trim し、空行を落とし、重複を1つにまとめる', () => {
    const r = normalizeReceiptRaw({
      isReceipt: true,
      store: ' だいどこスーパー ',
      items: [
        { name: ' 牛乳 ' },
        { name: '' },
        {},
        { name: '卵' },
        { name: '牛乳' }, // duplicate
        { name: '豚こま切れ肉' },
      ],
    });
    expect(r.isReceipt).toBe(true);
    expect(r.store).toBe('だいどこスーパー');
    expect(r.items).toEqual(['牛乳', '卵', '豚こま切れ肉']);
  });

  it('レシートでない場合は items 空・store null', () => {
    expect(normalizeReceiptRaw({ isReceipt: false })).toEqual({
      isReceipt: false,
      store: null,
      items: [],
    });
  });

  it('長すぎる品目名は 50 文字に切り詰める', () => {
    const long = 'あ'.repeat(80);
    const r = normalizeReceiptRaw({ isReceipt: true, items: [{ name: long }] });
    expect(r.items[0]).toHaveLength(50);
  });
});
