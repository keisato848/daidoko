/**
 * 相談画面（S18）の下書きフィクスチャ。
 *
 * `__tests__` 配下は tsconfig から除外されるので、`RecipeFormData` に必須欄が増えても
 * テスト内のリテラルは黙って古いまま緑になる（docs/品質基準.md §2.3）。
 * ここは型検査される場所なので、欄が増えたときにコンパイルで気づける。
 *
 * 中身が英語なのは lint の都合（`src/` 直下は日本語リテラル禁止・`test-support` は
 * 除外に入っていない）。差分ロジックは名前を小文字化して比べるだけなので言語は問わない。
 */
import type { RecipeFormData } from '../validation/recipe.schema';

export const CONSULT_DRAFT_TITLE = 'Chicken breast saute';
export const CONSULT_DRAFT_MAIN_INGREDIENT = 'chicken breast';
export const CONSULT_DRAFT_OIL = 'olive oil';

/** 2人分・20分・材料3・手順3 の基準下書き。`overrides` で差分だけ変える */
export function makeConsultDraft(overrides: Partial<RecipeFormData> = {}): RecipeFormData {
  return {
    title: CONSULT_DRAFT_TITLE,
    titleReading: '',
    description: '',
    servings: 2,
    cookTimeMin: 20,
    ingredients: [
      { groupLabel: '', name: CONSULT_DRAFT_MAIN_INGREDIENT, amount: '1 pc', note: '' },
      { groupLabel: '', name: 'salt', amount: 'pinch', note: '' },
      { groupLabel: '', name: CONSULT_DRAFT_OIL, amount: '1 tbsp', note: '' },
    ],
    steps: [{ body: 'Slice the chicken' }, { body: 'Sear' }, { body: 'Plate' }],
    tags: [],
    ...overrides,
  };
}
