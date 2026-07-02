import type { RecipeListItem } from '../../services/types';
import { sortRecipes } from '../recipeSort';

function r(overrides: Partial<RecipeListItem> & { id: string }): RecipeListItem {
  return {
    title: overrides.id,
    cookTimeMin: null,
    rating: null,
    tags: [],
    ingredientNames: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    ...overrides,
  };
}

describe('sortRecipes', () => {
  it('recent: 新しい createdAt が先頭', () => {
    const items = [
      r({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }),
      r({ id: 'b', createdAt: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(sortRecipes(items, 'recent').map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('cookCount: 調理回数が多い順', () => {
    const items = [r({ id: 'a', cookCount: 2 }), r({ id: 'b', cookCount: 9 })];
    expect(sortRecipes(items, 'cookCount').map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('rating: 高評価が先頭、null は最後', () => {
    const items = [
      r({ id: 'a', rating: null }),
      r({ id: 'b', rating: 3 }),
      r({ id: 'c', rating: 5 }),
    ];
    expect(sortRecipes(items, 'rating').map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('cookTime: 短い順、null は最後', () => {
    const items = [
      r({ id: 'a', cookTimeMin: 30 }),
      r({ id: 'b', cookTimeMin: null }),
      r({ id: 'c', cookTimeMin: 10 }),
    ];
    expect(sortRecipes(items, 'cookTime').map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('name: 日本語ロケールで昇順', () => {
    const items = [
      r({ id: '3', title: '豚汁' }),
      r({ id: '1', title: 'あんかけ' }),
      r({ id: '2', title: 'カレー' }),
    ];
    expect(sortRecipes(items, 'name').map((x) => x.title)).toEqual(['あんかけ', 'カレー', '豚汁']);
  });

  it('入力配列を変更しない', () => {
    const items = [r({ id: 'a', cookCount: 1 }), r({ id: 'b', cookCount: 5 })];
    const snapshot = items.map((x) => x.id);
    sortRecipes(items, 'cookCount');
    expect(items.map((x) => x.id)).toEqual(snapshot);
  });
});
