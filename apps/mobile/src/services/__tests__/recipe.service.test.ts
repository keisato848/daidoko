/**
 * Tests for recipe service (web/mock path)
 * We mock isNativePlatform to false so tests use the mock data path
 */
jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
  getExpoDb: jest.fn(),
}));

import {
  createRecipe,
  deleteRecipe,
  getRecipeDetail,
  getRecipeList,
  searchRecipes,
  updateRecipe,
} from '../recipe.service';
import type { SaveRecipeInput, UpdateRecipeInput } from '../types';
import { parseRecipeText } from '../../utils/recipeTextParser';

function assertDefined<T>(value: T | null | undefined): asserts value is T {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
}

describe('recipe.service (mock/web)', () => {
  describe('getRecipeList', () => {
    it('returns an array of recipes', async () => {
      const list = await getRecipeList();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    });

    it('each item has required fields', async () => {
      const list = await getRecipeList();
      const item = list[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('tags');
      expect(item).toHaveProperty('ingredientNames');
    });

    it('only includes active recipes', async () => {
      const list = await getRecipeList();
      expect(list.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('getRecipeDetail', () => {
    it('returns recipe detail for valid id', async () => {
      const detail = await getRecipeDetail('recipe-1');
      assertDefined(detail);
      expect(detail.title).toContain('肉じゃが');
      expect(detail.ingredients.length).toBeGreaterThan(0);
      expect(detail.steps.length).toBeGreaterThan(0);
    });

    it('returns null for invalid id', async () => {
      const detail = await getRecipeDetail('nonexistent');
      expect(detail).toBeNull();
    });

    it('includes tags', async () => {
      const detail = await getRecipeDetail('recipe-3');
      assertDefined(detail);
      expect(detail.tags).toContain('肉');
    });

    it('ingredients are sorted by sortOrder', async () => {
      const detail = await getRecipeDetail('recipe-1');
      assertDefined(detail);
      for (let i = 1; i < detail.ingredients.length; i++) {
        expect(detail.ingredients[i].sortOrder).toBeGreaterThanOrEqual(
          detail.ingredients[i - 1].sortOrder,
        );
      }
    });
  });

  describe('searchRecipes', () => {
    it('returns all recipes for empty query', async () => {
      const results = await searchRecipes('');
      const all = await getRecipeList();
      expect(results.length).toBe(all.length);
    });

    it('finds recipes by title', async () => {
      const results = await searchRecipes('味噌汁');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.title === '味噌汁')).toBe(true);
    });

    it('finds recipes by tag', async () => {
      const results = await searchRecipes('汁物');
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.tags.includes('汁物'))).toBe(true);
    });

    it('finds recipes by ingredient name', async () => {
      const results = await searchRecipes('じゃがいも');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('createRecipe', () => {
    it('creates a recipe and returns an id', async () => {
      const input: SaveRecipeInput = {
        title: 'テストレシピ',
        titleReading: 'てすとれしぴ',
        servings: 2,
        cookTimeMin: 15,
        ingredients: [
          { name: '卵', amount: '2個' },
          { name: '砂糖', amount: '大さじ1' },
        ],
        steps: [{ body: '卵を割る' }, { body: '砂糖を加えて混ぜる' }],
        tags: ['テスト'],
      };

      const id = await createRecipe(input);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      const list = await getRecipeList();
      const created = list.find((r) => r.id === id);
      assertDefined(created);
      expect(created.title).toBe('テストレシピ');
    });

    it('creates a recipe from parsed freeform text', async () => {
      const parsed = parseRecipeText(`
鶏そぼろ丼
2人分
材料
鶏ひき肉 200g
しょうゆ 大さじ2
みりん 大さじ2
卵 2個
作り方
1. 鶏ひき肉と調味料を炒める
2. 卵を炒り卵にする
3. ごはんに盛る
`);

      const id = await createRecipe(parsed.formData);
      const detail = await getRecipeDetail(id);

      assertDefined(detail);
      expect(detail.title).toBe('鶏そぼろ丼');
      expect(detail.servings).toBe(2);
      expect(detail.ingredients.map((ingredient) => ingredient.name)).toEqual([
        '鶏ひき肉',
        'しょうゆ',
        'みりん',
        '卵',
      ]);
      expect(detail.steps.map((step) => step.body)).toEqual([
        '鶏ひき肉と調味料を炒める',
        '卵を炒り卵にする',
        'ごはんに盛る',
      ]);
    });
  });

  describe('updateRecipe', () => {
    it('updates a recipe with a new revision', async () => {
      const createInput: SaveRecipeInput = {
        title: '更新テスト',
        ingredients: [{ name: '材料A' }],
        steps: [{ body: '手順1' }],
        tags: ['テスト'],
      };
      const id = await createRecipe(createInput);

      const input: UpdateRecipeInput = {
        title: '更新テスト（改良版）',
        servings: 6,
        cookTimeMin: 35,
        ingredients: [
          { name: 'じゃがいも', amount: '4個' },
          { name: '玉ねぎ', amount: '2個' },
        ],
        steps: [{ body: '材料を切る' }, { body: '煮込む' }],
        tags: ['肉', '煮物'],
      };

      const revId = await updateRecipe(id, input);
      expect(typeof revId).toBe('string');

      const detail = await getRecipeDetail(id);
      assertDefined(detail);
      expect(detail.title).toBe('更新テスト（改良版）');
      expect(detail.servings).toBe(6);
    });
  });

  describe('deleteRecipe', () => {
    it('soft-deletes a recipe (archived status)', async () => {
      const id = await createRecipe({
        title: '削除テスト',
        ingredients: [{ name: 'テスト' }],
        steps: [{ body: 'テスト' }],
        tags: [],
      });

      await deleteRecipe(id);

      const list = await getRecipeList();
      expect(list.find((r) => r.id === id)).toBeUndefined();

      const detail = await getRecipeDetail(id);
      expect(detail).toBeNull();
    });
  });
});
