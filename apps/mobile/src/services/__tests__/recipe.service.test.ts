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
  createRecipeMemo,
  deleteRecipe,
  getMemosForRecipe,
  getRecipeDetail,
  getRecipeList,
  getRecipeRevisions,
  getWantToCookRecipes,
  searchRecipes,
  setRecipePinned,
  updateRecipe,
} from '../recipe.service';
import { createOcrSource, createPhotoSource } from '../source.service';
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

    it('each item exposes heroPhotoUri', async () => {
      const list = await getRecipeList();
      for (const item of list) {
        expect(item).toHaveProperty('heroPhotoUri');
        // web/mock path has no persisted cooking photos
        expect(item.heroPhotoUri).toBeNull();
      }
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

    it('exposes heroPhotoUri (null on web/mock path)', async () => {
      const detail = await getRecipeDetail('recipe-1');
      assertDefined(detail);
      expect(detail).toHaveProperty('heroPhotoUri');
      expect(detail.heroPhotoUri).toBeNull();
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

    it('OCR-SVC-03 links an OCR source to the first recipe revision', async () => {
      const sourceId = await createOcrSource({
        rawText: '肉じゃが\n材料\nじゃがいも 3個\n作り方\n1. 煮る',
        capturedAt: '2026-05-27T10:00:00.000Z',
      });

      const id = await createRecipe({
        title: 'OCR由来レシピ',
        sourceId,
        ingredients: [{ name: 'じゃがいも', amount: '3個' }],
        steps: [{ body: '煮る' }],
        tags: [],
      });

      const revisions = await getRecipeRevisions(id);
      expect(revisions[0]).toMatchObject({ sourceId });
    });

    it('IMG-RECIPE-SVC-02 links a photo source to the first recipe revision', async () => {
      const sourceId = await createPhotoSource({
        labelSummary: 'Food 92% / Curry 81%',
        capturedAt: '2026-05-28T10:00:00.000Z',
      });

      const id = await createRecipe({
        title: '料理写真からのレシピ案',
        sourceId,
        ingredients: [{ name: '主食材（写真を見て確認）' }],
        steps: [{ body: '写真を確認して調理する' }],
        tags: ['写真から'],
      });

      const revisions = await getRecipeRevisions(id);
      expect(revisions[0]).toMatchObject({ sourceId });
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

      const revisions = await getRecipeRevisions(id);
      expect(revisions).toHaveLength(2);
      expect(revisions[0]).toMatchObject({
        id: revId,
        revisionNumber: 2,
        isCurrent: true,
        ingredientCount: 2,
        stepCount: 2,
      });
      expect(revisions[1]).toMatchObject({
        revisionNumber: 1,
        isCurrent: false,
        ingredientCount: 1,
        stepCount: 1,
      });
    });
  });

  describe('recipe memos', () => {
    it('getMemosForRecipe returns an array (empty on web/mock path)', async () => {
      const memos = await getMemosForRecipe('recipe-1');
      expect(Array.isArray(memos)).toBe(true);
      expect(memos).toHaveLength(0);
    });

    it('createRecipeMemo ignores blank input', async () => {
      expect(await createRecipeMemo('recipe-1', '   ')).toBeNull();
    });
  });

  describe('want-to-cook list (pin)', () => {
    afterEach(async () => {
      // 他のテストに影響しないよう全ピンを解除
      const pinned = await getWantToCookRecipes();
      await Promise.all(pinned.map((recipe) => setRecipePinned(recipe.id, false)));
      jest.useRealTimers();
    });

    it('pins and unpins a recipe', async () => {
      await setRecipePinned('recipe-1', true);
      const detail = await getRecipeDetail('recipe-1');
      assertDefined(detail);
      expect(detail.pinnedAt).not.toBeNull();
      expect((await getWantToCookRecipes()).some((r) => r.id === 'recipe-1')).toBe(true);

      await setRecipePinned('recipe-1', false);
      expect((await getWantToCookRecipes()).some((r) => r.id === 'recipe-1')).toBe(false);
    });

    it('orders by most recently pinned first', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
      await setRecipePinned('recipe-1', true);
      jest.setSystemTime(new Date('2026-01-01T00:01:00Z'));
      await setRecipePinned('recipe-2', true);

      const want = await getWantToCookRecipes();
      expect(want.map((r) => r.id)).toEqual(['recipe-2', 'recipe-1']);
    });

    it('unpinned recipes are excluded', async () => {
      const want = await getWantToCookRecipes();
      expect(want).toHaveLength(0);
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
