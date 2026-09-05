/**
 * 語彙防御の水平展開（`docs/品質基準.md` 規約②・2026-09-05）。
 * カテゴリ語（「調味料」「飲料」等）が在庫へ流れる 3 経路（レシート・食事写真・
 * 名寄せ）それぞれのサニタイズ／ガードを固定する。fridge は fridge.route.test が持つ。
 */
import { describe, expect, it } from 'vitest';

import { isCategoryItemName } from '../lib/fridge-vision.js';
import { sanitizeMealRaw } from '../lib/meal-vision.js';
import { parseResolved } from '../lib/name-resolve.js';
import { sanitizeReceiptRaw } from '../lib/receipt-vision.js';

describe('isCategoryItemName — 単体一致のみ', () => {
  it('カテゴリ語（表記ゆれ込み）に当たる', () => {
    expect(isCategoryItemName('調味料')).toBe(true);
    expect(isCategoryItemName('飲み物')).toBe(true);
    expect(isCategoryItemName('Drinks')).toBe(true);
    expect(isCategoryItemName(' その他 ')).toBe(true);
  });

  it('複合語（調味料入れ・野菜ジュース）は当たらない', () => {
    expect(isCategoryItemName('調味料入れ')).toBe(false);
    expect(isCategoryItemName('野菜ジュース')).toBe(false);
  });
});

describe('sanitizeReceiptRaw — カテゴリ語・売り場名の品目を除外', () => {
  it('カテゴリ語・売り場名は落とし、普通の品目は残す', () => {
    const raw = sanitizeReceiptRaw({
      isReceipt: true,
      store: 'だいどこスーパー',
      items: [
        { name: '牛乳', quantity: 1, unit: '本' },
        { name: '調味料' }, // カテゴリ語
        { name: '農産' }, // 売り場名（レシートの部門行）
        { name: '豚こま切れ肉' },
      ],
    });
    expect(raw.items?.map((i) => i.name)).toEqual(['牛乳', '豚こま切れ肉']);
    // 除外は品目だけ。isReceipt / store は触らない
    expect(raw.isReceipt).toBe(true);
    expect(raw.store).toBe('だいどこスーパー');
  });

  it('items が無い（isReceipt=false 等）応答はそのまま', () => {
    expect(sanitizeReceiptRaw({ isReceipt: false })).toEqual({ isReceipt: false });
  });
});

describe('sanitizeMealRaw — カテゴリ語の材料を除外', () => {
  it('「調味料」「野菜」…はカテゴリ語だけ落とす（具体名は残す）', () => {
    const raw = sanitizeMealRaw({
      isMeal: true,
      dish: '肉じゃが',
      ingredients: [{ name: 'じゃがいも' }, { name: '調味料' }, { name: '牛肉', amount: '200g' }],
    });
    expect(raw.ingredients?.map((i) => i.name)).toEqual(['じゃがいも', '牛肉']);
    expect(raw.dish).toBe('肉じゃが');
  });
});

describe('parseResolved — カテゴリ語への丸め上げを空文字扱いにする', () => {
  it('canonical がカテゴリ語なら空文字（非食材と同じ扱い＝自分自身にキャッシュされる）', () => {
    const resolved = parseResolved([
      { name: 'とっとごたまご', canonical: '卵' },
      { name: '味覇', canonical: '調味料' },
    ]);
    expect(resolved).toEqual([
      { name: 'とっとごたまご', canonical: '卵' },
      { name: '味覇', canonical: '' },
    ]);
  });
});
