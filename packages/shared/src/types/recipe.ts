/**
 * Recipe shared types — レシピ関連の共通型定義
 */

/** 食材ドラフト（エージェント間受け渡し用） */
export interface IngredientDraft {
  groupLabel?: string;
  name: string;
  amount?: string;
  note?: string;
}

/** 手順ドラフト（エージェント間受け渡し用） */
export interface StepDraft {
  body: string;
  timerSec?: number;
}

/** レシピドラフト（URL取り込み・OCR 結果の共通契約） */
export interface RecipeDraft {
  title: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  prepTimeMin?: number;
  ingredients: IngredientDraft[];
  steps: StepDraft[];
  sourceUrl?: string;
  confidence: 'high' | 'medium' | 'low';
}

/** レシピステータス */
export type RecipeStatus = 'active' | 'archived';

/** ソースタイプ */
export type SourceType = 'url' | 'ocr' | 'manual' | 'photo';

/** 栄養データソース */
export type NutritionDataSource = 'manual' | 'api' | 'estimated';

/** 買い物リストステータス */
export type ShoppingListStatus = 'active' | 'done';
