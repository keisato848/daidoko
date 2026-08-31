/**
 * 表紙の絵文字。英語のサンプルデータで全部が汎用の皿になってしまい、
 * ストア掲載のスクリーンショットが寂しくなったのが発端（英語対応で追加）。
 */
import { getRecipeEmoji } from '../recipeEmoji';
import { buildEnglishSeed } from '../../db/seed.en';
import { seedRecipes } from '../../db/seed';

describe('getRecipeEmoji', () => {
  it('日本語の料理名は完全一致で引く', () => {
    expect(getRecipeEmoji('肉じゃが')).toBe('🍲');
    expect(getRecipeEmoji('ハンバーグ')).toBe('🍔');
  });

  it('英語は語句の部分一致で引く', () => {
    // 🍜 はラーメン（麺鉢＋箸）で味噌汁の絵として誤り（ペルソナレビュー 1.12.2 #15）
    expect(getRecipeEmoji('Miso Soup')).toBe('🍲');
    expect(getRecipeEmoji('Karaage Fried Chicken')).toBe('🍗');
    expect(getRecipeEmoji('Takikomi Gohan (Mixed Rice)')).toBe('🍚');
  });

  it('限定的な語句が一般的な語句より優先される', () => {
    // steak より hamburg、beef より stew、soup より pork miso soup
    expect(getRecipeEmoji('Hamburg Steak')).toBe('🍔');
    expect(getRecipeEmoji('Nikujaga (Beef & Potato Stew)')).toBe('🍲');
    expect(getRecipeEmoji('Tonjiru Pork Miso Soup')).toBe('🫕');
  });

  it('大文字小文字を区別しない', () => {
    expect(getRecipeEmoji('CHICKEN CURRY')).toBe('🍛');
  });

  it('知らない料理名は汎用の皿', () => {
    expect(getRecipeEmoji('Something Unknown')).toBe('🍽️');
  });

  it('サンプルデータのレシピは日英どちらも汎用の皿にならない', () => {
    const generic: string[] = [];
    for (const recipe of seedRecipes) {
      if (getRecipeEmoji(recipe.title) === '🍽️') generic.push(`ja: ${recipe.title}`);
    }
    for (const recipe of buildEnglishSeed().recipes) {
      if (getRecipeEmoji(recipe.title) === '🍽️') generic.push(`en: ${recipe.title}`);
    }
    expect(generic).toEqual([]);
  });
});
