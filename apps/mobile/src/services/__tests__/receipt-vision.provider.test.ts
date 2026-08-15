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
    expect(r.items.map((it) => it.name)).toEqual(['牛乳', '卵', '豚こま切れ肉']);
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
    expect(r.items[0].name).toHaveLength(50);
  });

  it('数量・単位を正規化して通す', () => {
    const r = normalizeReceiptRaw({
      isReceipt: true,
      items: [
        { name: '牛乳', quantity: 2, unit: '本' },
        { name: '豚こま', quantity: 0.5, unit: 'kg' }, // kg → g へ寄せる
        { name: 'トマト', quantity: 3 }, // 単位なしの個数
      ],
    });
    expect(r.items).toEqual([
      { name: '牛乳', quantity: 2, unit: '本' },
      { name: '豚こま', quantity: 500, unit: 'g' },
      { name: 'トマト', quantity: 3, unit: null },
    ]);
  });

  it('数量が読めなかった品目は quantity=null のまま通す（1 で埋めない）', () => {
    const r = normalizeReceiptRaw({
      isReceipt: true,
      items: [{ name: '玉ねぎ' }, { name: 'にんじん', unit: '個' }],
    });
    expect(r.items).toEqual([
      { name: '玉ねぎ', quantity: null, unit: null },
      { name: 'にんじん', quantity: null, unit: '個' },
    ]);
  });

  it('同じ品目×同じ単位は数量を合算する（在庫の合算規則と同じ）', () => {
    const r = normalizeReceiptRaw({
      isReceipt: true,
      items: [
        { name: 'ﾆﾝｼﾞﾝ', quantity: 1, unit: '本' },
        { name: 'にんじん', quantity: 2, unit: '本' }, // 半角カナ/かな — 正規化すると同じ
      ],
    });
    expect(r.items).toEqual([{ name: 'ﾆﾝｼﾞﾝ', quantity: 3, unit: '本' }]);
  });

  it('片方の数量が読めなければ合算せず null（＝数量未管理）にする', () => {
    const r = normalizeReceiptRaw({
      isReceipt: true,
      items: [
        { name: '卵', quantity: 1, unit: 'パック' },
        { name: '卵', unit: 'パック' },
      ],
    });
    expect(r.items).toEqual([{ name: '卵', quantity: null, unit: 'パック' }]);
  });

  it('単位が違えば別の行として残す（在庫でも合算されないため）', () => {
    const r = normalizeReceiptRaw({
      isReceipt: true,
      items: [
        { name: '豚こま', quantity: 300, unit: 'g' },
        { name: '豚こま', quantity: 1, unit: 'パック' },
      ],
    });
    expect(r.items).toEqual([
      { name: '豚こま', quantity: 300, unit: 'g' },
      { name: '豚こま', quantity: 1, unit: 'パック' },
    ]);
  });
});
