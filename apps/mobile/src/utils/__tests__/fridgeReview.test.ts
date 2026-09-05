/**
 * 冷蔵庫写真の確認シートの純ロジック（`docs/冷蔵庫写真設計.md` §4）。
 * ここで固定するのは 2 点:
 * - confidence → 3 段階の境界（0.8 / 0.5。低いものが「たぶん」表示になる）
 * - 既存在庫との重複判定（名寄せ済み比較）と「既定オフ・消さない」
 */
import {
  buildFridgeReviewItems,
  canonicalNameKey,
  classifyFridgeConfidence,
  parseFridgeQuantityText,
} from '../fridgeReview';

describe('classifyFridgeConfidence — 境界は 0.8 / 0.5（以上で上の段）', () => {
  it.each([
    [1, 'high'],
    [0.8, 'high'],
    [0.79, 'medium'],
    [0.5, 'medium'],
    [0.49, 'low'],
    [0, 'low'],
  ] as const)('%f → %s', (confidence, band) => {
    expect(classifyFridgeConfidence(confidence)).toBe(band);
  });

  it('数値でない値は low へ倒す（高く見せると確認されなくなる）', () => {
    expect(classifyFridgeConfidence(Number.NaN)).toBe('low');
  });
});

describe('canonicalNameKey — エイリアス辞書を通してから正規化', () => {
  it('辞書に無い名前は正規化だけ（全半角・カナ/かな・空白の差を吸収）', () => {
    expect(canonicalNameKey('ﾄﾏﾄ', {})).toBe(canonicalNameKey('トマト', {}));
    expect(canonicalNameKey('豚 バラ', {})).toBe(canonicalNameKey('豚バラ', {}));
  });

  it('辞書にある名前は正規名へ落としてから比べる', () => {
    const aliasMap = { 豚ばら薄切り: '豚バラ肉' };
    expect(canonicalNameKey('豚バラ薄切り', aliasMap)).toBe(canonicalNameKey('豚バラ肉', {}));
  });
});

describe('buildFridgeReviewItems — 重複は外さずに見せて既定オフ', () => {
  const items = [
    { name: '牛乳', confidence: 0.95 },
    { name: 'にんじん', confidence: 0.6 },
    { name: '味噌', confidence: 0.3 },
  ];

  it('在庫に無い品は include=true・在庫にある品は inPantry=true で既定オフ', () => {
    const rows = buildFridgeReviewItems(items, ['牛乳']);
    expect(rows.map((r) => ({ name: r.name, inPantry: r.inPantry, include: r.include }))).toEqual([
      { name: '牛乳', inPantry: true, include: false },
      { name: 'にんじん', inPantry: false, include: true },
      { name: '味噌', inPantry: false, include: true },
    ]);
  });

  it('重複でも行そのものは消さない（利用者が見て選び直せる）', () => {
    const rows = buildFridgeReviewItems(items, ['牛乳', 'にんじん', '味噌']);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.include)).toBe(true);
  });

  it('在庫との比較は名寄せ済み（エイリアス辞書＋正規化）で行う', () => {
    const aliasMap = { 豚ばら薄切り: '豚バラ肉' };
    const rows = buildFridgeReviewItems(
      [{ name: '豚バラ薄切り', confidence: 0.9 }],
      ['豚バラ肉'],
      aliasMap,
    );
    expect(rows[0].inPantry).toBe(true);
    expect(rows[0].include).toBe(false);
  });

  it('confidence の 3 段階が band に載る（低いものが「たぶん」表示になる）', () => {
    const rows = buildFridgeReviewItems(items, []);
    expect(rows.map((r) => r.band)).toEqual(['high', 'medium', 'low']);
  });
});

describe('buildFridgeReviewItems — 数量（読めた場合のみ・編集可）', () => {
  it('quantity をそのまま行へ載せ、無ければ空欄（数量未管理）にする', () => {
    const rows = buildFridgeReviewItems(
      [
        { name: 'にんじん', confidence: 0.9, quantity: '3本' },
        { name: '味噌', confidence: 0.9, quantity: null },
        { name: '卵', confidence: 0.9 },
      ],
      [],
    );
    expect(rows.map((r) => r.quantity)).toEqual(['3本', '', '']);
  });
});

describe('parseFridgeQuantityText — 自由テキスト → 在庫の quantity × unit', () => {
  it.each([
    ['3本', 3, '本'],
    ['約200g', 200, 'g'],
    ['1パック', 1, 'パック'],
    ['２個', 2, '個'], // 全角も NFKC で読む
    ['1.5L', 1.5, 'L'],
    ['3', 3, null],
  ] as const)('%s → %s %s', (text, quantity, unit) => {
    expect(parseFridgeQuantityText(text)).toEqual({ quantity, unit });
  });

  it('数えられない表現・空欄は数量未管理（推測で 1 にしない）', () => {
    expect(parseFridgeQuantityText('')).toEqual({ quantity: null, unit: null });
    expect(parseFridgeQuantityText('少し')).toEqual({ quantity: null, unit: null });
    expect(parseFridgeQuantityText('残りわずか')).toEqual({ quantity: null, unit: null });
  });
});
