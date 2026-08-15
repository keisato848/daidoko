import {
  formatQuantityInput,
  normalizeReceiptQuantity,
  parseQuantityInput,
} from '../receiptQuantity';

describe('normalizeReceiptQuantity', () => {
  it('単位の表記ゆれを在庫の表記に寄せる', () => {
    expect(normalizeReceiptQuantity(2, 'ｺ')).toEqual({ quantity: 2, unit: '個' });
    expect(normalizeReceiptQuantity(1, 'ﾊﾟｯｸ')).toEqual({ quantity: 1, unit: 'パック' });
    expect(normalizeReceiptQuantity(1, 'P')).toEqual({ quantity: 1, unit: 'パック' });
    expect(normalizeReceiptQuantity(200, 'グラム')).toEqual({ quantity: 200, unit: 'g' });
    expect(normalizeReceiptQuantity(500, 'ｇ')).toEqual({ quantity: 500, unit: 'g' });
    expect(normalizeReceiptQuantity(200, 'cc')).toEqual({ quantity: 200, unit: 'ml' });
  });

  it('kg / L はグラム・ミリリットルへ換算する（同じ品物が別単位に分かれないように）', () => {
    expect(normalizeReceiptQuantity(1.5, 'kg')).toEqual({ quantity: 1500, unit: 'g' });
    expect(normalizeReceiptQuantity(1, 'リットル')).toEqual({ quantity: 1000, unit: 'ml' });
  });

  it('飾り（括弧・スラッシュ）を落とす', () => {
    expect(normalizeReceiptQuantity(3, '(個)')).toEqual({ quantity: 3, unit: '個' });
    expect(normalizeReceiptQuantity(3, '/本')).toEqual({ quantity: 3, unit: '本' });
  });

  it('単位でない付帯表記は捨てて数量だけ残す', () => {
    expect(normalizeReceiptQuantity(3, '点')).toEqual({ quantity: 3, unit: null });
    expect(normalizeReceiptQuantity(2, '×')).toEqual({ quantity: 2, unit: null });
    expect(normalizeReceiptQuantity(2, '198円')).toEqual({ quantity: 2, unit: null });
    expect(normalizeReceiptQuantity(2, '  ')).toEqual({ quantity: 2, unit: null });
  });

  it('知らない単位はそのまま残す（利用者が確認画面で直せる）', () => {
    expect(normalizeReceiptQuantity(1, 'ざる')).toEqual({ quantity: 1, unit: 'ざる' });
  });

  it('数量が無ければ null のまま（1 で埋めない）', () => {
    expect(normalizeReceiptQuantity(undefined, '個')).toEqual({ quantity: null, unit: '個' });
    expect(normalizeReceiptQuantity(null, null)).toEqual({ quantity: null, unit: null });
    expect(normalizeReceiptQuantity(Number.NaN, '本')).toEqual({ quantity: null, unit: '本' });
  });

  it('0 以下・個数として大きすぎる数量は捨てる（単価や値引き額の紛れ込み対策）', () => {
    expect(normalizeReceiptQuantity(0, '個')).toEqual({ quantity: null, unit: '個' });
    expect(normalizeReceiptQuantity(-1, '個')).toEqual({ quantity: null, unit: '個' });
    expect(normalizeReceiptQuantity(198, '個')).toEqual({ quantity: null, unit: '個' });
    expect(normalizeReceiptQuantity(198, null)).toEqual({ quantity: null, unit: null });
  });

  it('g / ml は大きい数量も通す（内容量なので 500g は正しい）', () => {
    expect(normalizeReceiptQuantity(500, 'g')).toEqual({ quantity: 500, unit: 'g' });
    expect(normalizeReceiptQuantity(1_000_000, 'g')).toEqual({ quantity: null, unit: 'g' });
  });
});

describe('parseQuantityInput / formatQuantityInput', () => {
  it('空欄は null（＝数量未管理）', () => {
    expect(parseQuantityInput('')).toBeNull();
    expect(parseQuantityInput('   ')).toBeNull();
  });

  it('全角数字も読む', () => {
    expect(parseQuantityInput('２')).toBe(2);
    expect(parseQuantityInput(' 1.5 ')).toBe(1.5);
  });

  it('数値でない・0 以下は null', () => {
    expect(parseQuantityInput('たくさん')).toBeNull();
    expect(parseQuantityInput('0')).toBeNull();
    expect(parseQuantityInput('-3')).toBeNull();
  });

  it('null は空欄に戻る（往復できる）', () => {
    expect(formatQuantityInput(null)).toBe('');
    expect(parseQuantityInput(formatQuantityInput(2.5))).toBe(2.5);
  });
});
