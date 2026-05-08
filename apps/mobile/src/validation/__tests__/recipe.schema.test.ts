import { recipeFormSchema, ingredientSchema, stepSchema } from '../recipe.schema';

const validIngredient = { name: 'じゃがいも', amount: '', groupLabel: '', note: '' };
const validStep = { body: '材料を切る' };

describe('recipe.schema', () => {
  describe('recipeFormSchema', () => {
    it('validates a complete valid recipe', () => {
      const result = recipeFormSchema.safeParse({
        title: '肉じゃが',
        titleReading: '',
        description: '',
        ingredients: [{ name: 'じゃがいも', amount: '3個', groupLabel: '', note: '' }],
        steps: [validStep],
        tags: ['肉', '煮物'],
      });
      expect(result.success).toBe(true);
    });

    it('requires a title', () => {
      const result = recipeFormSchema.safeParse({
        title: '',
        titleReading: '',
        description: '',
        ingredients: [validIngredient],
        steps: [validStep],
        tags: [],
      });
      expect(result.success).toBe(false);
    });

    it('enforces title max length', () => {
      const result = recipeFormSchema.safeParse({
        title: 'a'.repeat(101),
        titleReading: '',
        description: '',
        ingredients: [validIngredient],
        steps: [validStep],
        tags: [],
      });
      expect(result.success).toBe(false);
    });

    it('requires at least one ingredient', () => {
      const result = recipeFormSchema.safeParse({
        title: 'テスト',
        titleReading: '',
        description: '',
        ingredients: [],
        steps: [validStep],
        tags: [],
      });
      expect(result.success).toBe(false);
    });

    it('requires at least one step', () => {
      const result = recipeFormSchema.safeParse({
        title: 'テスト',
        titleReading: '',
        description: '',
        ingredients: [validIngredient],
        steps: [],
        tags: [],
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional fields', () => {
      const result = recipeFormSchema.safeParse({
        title: 'テスト',
        titleReading: 'てすと',
        description: '説明文',
        servings: 4,
        cookTimeMin: 30,
        prepTimeMin: 15,
        ingredients: [{ name: 'テスト', amount: '適量', groupLabel: 'A', note: '' }],
        steps: [{ body: '手順1', timerSec: 60 }],
        tags: ['テスト'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ingredientSchema', () => {
    it('validates a valid ingredient', () => {
      const result = ingredientSchema.safeParse(validIngredient);
      expect(result.success).toBe(true);
    });

    it('requires a name', () => {
      const result = ingredientSchema.safeParse({ name: '', amount: '', groupLabel: '', note: '' });
      expect(result.success).toBe(false);
    });

    it('enforces name max length', () => {
      const result = ingredientSchema.safeParse({
        name: 'a'.repeat(51),
        amount: '',
        groupLabel: '',
        note: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('stepSchema', () => {
    it('validates a valid step', () => {
      const result = stepSchema.safeParse({ body: '材料を切る' });
      expect(result.success).toBe(true);
    });

    it('requires a body', () => {
      const result = stepSchema.safeParse({ body: '' });
      expect(result.success).toBe(false);
    });

    it('enforces body max length', () => {
      const result = stepSchema.safeParse({ body: 'a'.repeat(501) });
      expect(result.success).toBe(false);
    });

    it('accepts optional timerSec', () => {
      const result = stepSchema.safeParse({ body: 'テスト', timerSec: 300 });
      expect(result.success).toBe(true);
    });
  });
});
