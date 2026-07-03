/**
 * Zod validation schemas for recipe creation/editing
 */
import { z } from 'zod';

export const ingredientSchema = z.object({
  groupLabel: z.string().max(30),
  name: z.string().min(1, '材料名は必須です').max(50, '50文字以内で入力してください'),
  amount: z.string().max(30),
  note: z.string().max(100),
});

export const stepSchema = z.object({
  body: z.string().min(1, '手順は必須です').max(500, '500文字以内で入力してください'),
  timerSec: z.number().int().min(0).optional(),
  /** 手順写真（端末内パス） */
  photoPath: z.string().optional(),
});

export const recipeFormSchema = z.object({
  title: z.string().min(1, 'レシピ名は必須です').max(100, '100文字以内で入力してください'),
  titleReading: z.string().max(100),
  description: z.string().max(500),
  servings: z.number().int().min(1).max(99).optional(),
  cookTimeMin: z.number().int().min(1).max(999).optional(),
  prepTimeMin: z.number().int().min(1).max(999).optional(),
  /** 表紙写真（端末内パス） */
  coverPhotoPath: z.string().optional(),
  ingredients: z.array(ingredientSchema).min(1, '材料を1つ以上追加してください'),
  steps: z.array(stepSchema).min(1, '手順を1つ以上追加してください'),
  tags: z.array(z.string()),
});

export type RecipeFormData = z.infer<typeof recipeFormSchema>;
export type IngredientFormData = z.infer<typeof ingredientSchema>;
export type StepFormData = z.infer<typeof stepSchema>;
