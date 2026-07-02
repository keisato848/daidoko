/**
 * PhotoInferAgent — server-side dish-photo → editable RecipeDraft via Vision LLM.
 *
 * Returns the shared AgentResult/RecipeDraft contract (same as URL import), so
 * the mobile client reuses its existing draft → RecipeForm mapping. The image
 * is used only for inference and never persisted.
 */
import {
  VisionConfigError,
  VisionRequestError,
  type VisionRecipeInput,
  type VisionRecipeProvider,
  type VisionRecipeRaw,
} from '../lib/vision-recipe.js';

// Locally-defined contract, mirroring @daidoko/shared. The server tsconfig uses
// a strict rootDir that excludes cross-package source imports (see
// url-fetch.agent.ts, which defines the same shapes locally).
export type AgentErrorCode =
  | 'AI_API_UNAVAILABLE'
  | 'PHOTO_RECIPE_FAILED'
  | 'VISION_NOT_A_DISH'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export interface AgentResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: AgentErrorCode; message: string; retryable: boolean };
}

export interface IngredientDraft {
  groupLabel?: string;
  name: string;
  amount?: string;
  note?: string;
}

export interface StepDraft {
  body: string;
}

/** Mirrors @daidoko/shared RecipeDraft (the URL-import / OCR draft contract). */
export interface RecipeDraft {
  title: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients: IngredientDraft[];
  steps: StepDraft[];
  tags?: string[];
  confidence: 'high' | 'medium' | 'low';
}

const NOT_A_DISH_MESSAGE =
  '写真から料理を認識できませんでした。料理がはっきり写った写真でお試しください。';

function fail(code: AgentErrorCode, message: string, retryable: boolean): AgentResult<RecipeDraft> {
  return { ok: false, error: { code, message, retryable } };
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function cleanPositiveInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return undefined;
  return rounded;
}

function normalizeDraft(raw: VisionRecipeRaw): RecipeDraft | null {
  const title = cleanString(raw.title, 100);
  const ingredients = (raw.ingredients ?? [])
    .map((item) => {
      const name = cleanString(item?.name, 50);
      if (!name) return null;
      const groupLabel = cleanString(item?.groupLabel, 30);
      const amount = cleanString(item?.amount, 30);
      const note = cleanString(item?.note, 100);
      return {
        name,
        ...(groupLabel !== undefined && { groupLabel }),
        ...(amount !== undefined && { amount }),
        ...(note !== undefined && { note }),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const steps = (raw.steps ?? [])
    .map((item) => {
      const body = cleanString(item?.body, 500);
      return body ? { body } : null;
    })
    .filter((item): item is { body: string } => item !== null);

  // The shared RecipeDraft / recipeFormSchema require a title and at least one
  // ingredient and step. Anything short of that is not a usable draft.
  if (!title || ingredients.length === 0 || steps.length === 0) return null;

  const titleReading = cleanString(raw.titleReading, 100);
  const description = cleanString(raw.description, 500);
  const servings = cleanPositiveInt(raw.servings, 1, 99);
  const cookTimeMin = cleanPositiveInt(raw.cookTimeMin, 1, 999);
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => cleanString(tag, 30))
        .filter((tag): tag is string => tag !== undefined)
        .slice(0, 10)
    : [];
  const confidence =
    raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
      ? raw.confidence
      : 'low';

  return {
    title,
    ...(titleReading !== undefined && { titleReading }),
    ...(description !== undefined && { description }),
    ...(servings !== undefined && { servings }),
    ...(cookTimeMin !== undefined && { cookTimeMin }),
    ingredients,
    steps,
    ...(tags.length > 0 && { tags }),
    confidence,
  };
}

export async function runPhotoInferAgent(
  input: VisionRecipeInput,
  provider: VisionRecipeProvider,
): Promise<AgentResult<RecipeDraft>> {
  let raw: VisionRecipeRaw;
  try {
    raw = await provider.infer(input);
  } catch (err) {
    if (err instanceof VisionConfigError) {
      return fail('AI_API_UNAVAILABLE', 'AI 推論が利用できません', false);
    }
    if (err instanceof VisionRequestError) {
      return fail('AI_API_UNAVAILABLE', 'AI 推論サービスへの接続に失敗しました', true);
    }
    return fail(
      'PHOTO_RECIPE_FAILED',
      err instanceof Error ? err.message : '料理写真の推論に失敗しました',
      true,
    );
  }

  if (!raw.isDish) {
    return fail('VISION_NOT_A_DISH', NOT_A_DISH_MESSAGE, false);
  }

  const draft = normalizeDraft(raw);
  if (!draft) {
    return fail(
      'PHOTO_RECIPE_FAILED',
      '推論結果をレシピ下書きに変換できませんでした。もう一度お試しください。',
      true,
    );
  }

  return { ok: true, data: draft };
}
