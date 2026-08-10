/**
 * Zod validation schemas for recipe creation/editing
 *
 * **メッセージには辞書のキーを入れる。** ここで t() を呼ぶと、スキーマは
 * モジュール読み込み時に組み立てられるので import 時のロケールで固定される。
 * 画面に出す直前に `tDynamic()` で引く（RecipeForm・FormField）。
 */
import { z } from 'zod';

export const ingredientSchema = z.object({
  groupLabel: z.string().max(30),
  name: z
    .string()
    .min(1, 'recipe.validation.ingredientNameRequired')
    .max(50, 'recipe.validation.ingredientNameTooLong'),
  amount: z.string().max(30),
  note: z.string().max(100),
});

export const stepSchema = z.object({
  body: z
    .string()
    .min(1, 'recipe.validation.stepRequired')
    .max(500, 'recipe.validation.stepTooLong'),
  timerSec: z.number().int().min(0).optional(),
  /** 手順写真（端末内パス） */
  photoPath: z.string().optional(),
});

export const recipeFormSchema = z.object({
  title: z
    .string()
    .min(1, 'recipe.validation.titleRequired')
    .max(100, 'recipe.validation.titleTooLong'),
  titleReading: z.string().max(100),
  description: z.string().max(500),
  servings: z.number().int().min(1).max(99).optional(),
  cookTimeMin: z.number().int().min(1).max(999).optional(),
  prepTimeMin: z.number().int().min(1).max(999).optional(),
  /** 表紙写真（端末内パス） */
  coverPhotoPath: z.string().optional(),
  ingredients: z.array(ingredientSchema).min(1, 'recipe.validation.ingredientsRequired'),
  steps: z.array(stepSchema).min(1, 'recipe.validation.stepsRequired'),
  tags: z.array(z.string()),
});

export type RecipeFormData = z.infer<typeof recipeFormSchema>;
export type IngredientFormData = z.infer<typeof ingredientSchema>;
export type StepFormData = z.infer<typeof stepSchema>;
