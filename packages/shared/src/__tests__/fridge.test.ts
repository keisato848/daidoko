/**
 * 冷蔵庫写真読み取りの契約の固定（`docs/冷蔵庫写真設計.md`）。
 * サーバーは同じ形の zod をローカルに写しているため、ここが**契約の正**として
 * 制約値（画像 1〜2 枚・品目 60・confidence 0〜1・分量欄なし）をテストで固定する。
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_FRIDGE_IMAGES,
  MAX_FRIDGE_ITEMS,
  fridgeInferRequestSchema,
  fridgeInferResponseSchema,
  fridgeItemSchema,
} from '../types/fridge';

const IMAGE = { imageBase64: 'Zm9v', mimeType: 'image/jpeg' } as const;

describe('fridgeInferRequestSchema — 画像は 1〜2 枚', () => {
  it('1 枚で通り、0 枚・3 枚は弾く', () => {
    expect(MAX_FRIDGE_IMAGES).toBe(2);
    expect(fridgeInferRequestSchema.safeParse({ images: [IMAGE] }).success).toBe(true);
    expect(fridgeInferRequestSchema.safeParse({ images: [] }).success).toBe(false);
    expect(fridgeInferRequestSchema.safeParse({ images: [IMAGE, IMAGE, IMAGE] }).success).toBe(
      false,
    );
  });

  it('未対応の mimeType は弾く', () => {
    expect(
      fridgeInferRequestSchema.safeParse({
        images: [{ imageBase64: 'Zm9v', mimeType: 'image/gif' }],
      }).success,
    ).toBe(false);
  });
});

describe('fridgeItemSchema — 品名と確からしさだけ', () => {
  it('confidence は 0〜1 の数値', () => {
    expect(fridgeItemSchema.safeParse({ name: '味噌', confidence: 0 }).success).toBe(true);
    expect(fridgeItemSchema.safeParse({ name: '味噌', confidence: 1 }).success).toBe(true);
    expect(fridgeItemSchema.safeParse({ name: '味噌', confidence: 1.1 }).success).toBe(false);
    expect(fridgeItemSchema.safeParse({ name: '味噌', confidence: -0.1 }).success).toBe(false);
  });

  it('分量・数量の欄を持たない（strict でなくとも契約上の欄が無いことを固定）', () => {
    const parsed = fridgeItemSchema.parse({ name: '牛乳', confidence: 0.9, quantity: 2 });
    expect(parsed).toEqual({ name: '牛乳', confidence: 0.9 });
  });
});

describe('fridgeInferResponseSchema — 品目数の上限', () => {
  it('空配列（読み取れなかった）を許し、上限 60 を超えると弾く', () => {
    expect(MAX_FRIDGE_ITEMS).toBe(60);
    expect(fridgeInferResponseSchema.safeParse({ items: [] }).success).toBe(true);
    const tooMany = Array.from({ length: MAX_FRIDGE_ITEMS + 1 }, (_, i) => ({
      name: `品目${i}`,
      confidence: 0.5,
    }));
    expect(fridgeInferResponseSchema.safeParse({ items: tooMany }).success).toBe(false);
  });
});
