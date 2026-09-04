/**
 * M3（§10.12）契約の固定。サーバーは同じ形の zod をローカルに写しているため、
 * ここが**契約の正**として制約値（品数 1〜7・タイトル 30・在庫 50・メモ 400 字）を
 * テストで固定する — 写しがずれたときに気づく基準点。
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_MENU_RECIPES_DAYS,
  MAX_MENU_RECIPES_PANTRY,
  MAX_MENU_RECIPES_PREFERENCES,
  MAX_MENU_RECIPES_TITLES,
  menuRecipeDraftSchema,
  menuRecipesRequestSchema,
} from '../types/menu-recipes';

const VALID_DRAFT = {
  title: '鶏むね肉の照り焼き',
  ingredients: [{ name: '鶏むね肉', amount: '1枚' }],
  steps: [{ body: '焼く' }],
};

describe('menuRecipeDraftSchema — consult の下書き型と揃えた形', () => {
  it('材料と手順が 1 つ以上ある下書きを受け付ける', () => {
    expect(menuRecipeDraftSchema.safeParse(VALID_DRAFT).success).toBe(true);
  });

  it('材料が空の下書きは弾く（半端な下書きは保存できない）', () => {
    expect(menuRecipeDraftSchema.safeParse({ ...VALID_DRAFT, ingredients: [] }).success).toBe(
      false,
    );
  });

  it('手順が空の下書きは弾く', () => {
    expect(menuRecipeDraftSchema.safeParse({ ...VALID_DRAFT, steps: [] }).success).toBe(false);
  });
});

describe('menuRecipesRequestSchema — 上限の固定', () => {
  const base = { days: 3, existingTitles: [], pantry: [] };

  it('days は 1〜7（品数分呼ばない = 1 回で n 品の契約の n の範囲）', () => {
    expect(MAX_MENU_RECIPES_DAYS).toBe(7);
    expect(menuRecipesRequestSchema.safeParse({ ...base, days: 0 }).success).toBe(false);
    expect(menuRecipesRequestSchema.safeParse({ ...base, days: 8 }).success).toBe(false);
    expect(menuRecipesRequestSchema.safeParse({ ...base, days: 7 }).success).toBe(true);
  });

  it('existingTitles は最大 30・pantry は最大 50', () => {
    expect(MAX_MENU_RECIPES_TITLES).toBe(30);
    expect(MAX_MENU_RECIPES_PANTRY).toBe(50);
    expect(
      menuRecipesRequestSchema.safeParse({
        ...base,
        existingTitles: Array.from({ length: 31 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false);
    expect(
      menuRecipesRequestSchema.safeParse({
        ...base,
        pantry: Array.from({ length: 51 }, (_, i) => `p${i}`),
      }).success,
    ).toBe(false);
  });

  it('嗜好メモは最大 400 字・任意', () => {
    expect(MAX_MENU_RECIPES_PREFERENCES).toBe(400);
    expect(
      menuRecipesRequestSchema.safeParse({ ...base, preferences: 'あ'.repeat(401) }).success,
    ).toBe(false);
    expect(menuRecipesRequestSchema.safeParse(base).success).toBe(true);
  });
});
