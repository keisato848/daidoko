import { rankByCoverage } from '../cookable.service';
import type { RecipeListItem } from '../types';
import { normalizeItemName } from '../../utils/itemName';

function recipe(id: string, title: string, ingredientNames: string[]): RecipeListItem {
  return {
    id,
    title,
    cookTimeMin: null,
    rating: null,
    tags: [],
    ingredientNames,
    createdAt: '',
    cookCount: 0,
    heroPhotoUri: null,
  };
}

describe('rankByCoverage', () => {
  const inStock = ['玉ねぎ', 'にんじん', 'じゃがいも'].map(normalizeItemName);
  const recipes = [
    recipe('curry', 'カレー', ['玉ねぎ', 'にんじん', 'じゃがいも', '牛肉']), // 3/4
    recipe('salad', 'サラダ', ['にんじん', 'レタス']), // 1/2
    recipe('nikujaga', '肉じゃが', ['玉ねぎ', 'じゃがいも']), // 2/2
  ];

  it('ranks by coverage descending', () => {
    const ranked = rankByCoverage(recipes, inStock);
    expect(ranked.map((r) => r.recipeId)).toEqual(['nikujaga', 'curry', 'salad']);
  });

  it('computes coverage, in-stock count, and missing names', () => {
    const ranked = rankByCoverage(recipes, inStock);
    const curry = ranked.find((r) => r.recipeId === 'curry');
    expect(curry?.coverage).toBeCloseTo(0.75);
    expect(curry?.inStock).toBe(3);
    expect(curry?.missing).toEqual(['牛肉']);

    const nikujaga = ranked.find((r) => r.recipeId === 'nikujaga');
    expect(nikujaga?.coverage).toBe(1);
    expect(nikujaga?.missing).toEqual([]);
  });

  it('handles an empty pantry (all coverage 0)', () => {
    const ranked = rankByCoverage(recipes, []);
    expect(ranked.every((r) => r.coverage === 0)).toBe(true);
  });

  it('handles a recipe with no ingredients (coverage 0, not NaN)', () => {
    const ranked = rankByCoverage([recipe('empty', '空', [])], inStock);
    expect(ranked[0].coverage).toBe(0);
    expect(ranked[0].total).toBe(0);
  });
});
