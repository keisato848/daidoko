/**
 * Vision recipe provider — sends a dish photo (+ optional notes) to the server
 * Vision LLM endpoint and returns an editable recipe draft.
 *
 * The image is read locally, base64-encoded, and posted to
 * POST /api/v1/infer/photo. The server uses it only for inference and does not
 * persist it. On any failure this throws, so the A2 agent can fall back to the
 * on-device heuristic / OCR path.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { API_V1 } from '../config';
import type { RecipeFormData } from '../validation/recipe.schema';

const TIMEOUT_MS = 35_000;

export interface VisionInferenceResult {
  draft: RecipeFormData;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

interface ServerIngredient {
  groupLabel?: string;
  name: string;
  amount?: string;
  note?: string;
}

interface ServerRecipeDraft {
  title: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients: ServerIngredient[];
  steps: { body: string }[];
  tags?: string[];
  confidence: 'high' | 'medium' | 'low';
}

interface ServerAgentResult {
  ok: boolean;
  data?: ServerRecipeDraft;
  error?: { code: string; message: string; retryable: boolean };
}

export type VisionErrorKind = 'not_a_dish' | 'rate_limited' | 'transient' | 'failed';

export class VisionInferenceError extends Error {
  readonly retryable: boolean;
  readonly kind: VisionErrorKind;
  constructor(message: string, retryable: boolean, kind: VisionErrorKind = 'failed') {
    super(message);
    this.name = 'VisionInferenceError';
    this.retryable = retryable;
    this.kind = kind;
  }
}

function kindFromCode(code: string | undefined): VisionErrorKind {
  if (code === 'VISION_NOT_A_DISH') return 'not_a_dish';
  if (code === 'RATE_LIMITED') return 'rate_limited';
  if (code === 'AI_API_UNAVAILABLE') return 'transient';
  return 'failed';
}

function toFormData(draft: ServerRecipeDraft): RecipeFormData {
  return {
    title: draft.title,
    titleReading: draft.titleReading ?? '',
    description: draft.description ?? '',
    ...(draft.servings !== undefined && { servings: draft.servings }),
    ...(draft.cookTimeMin !== undefined && { cookTimeMin: draft.cookTimeMin }),
    ingredients: draft.ingredients.map((ing) => ({
      groupLabel: ing.groupLabel ?? '',
      name: ing.name,
      amount: ing.amount ?? '',
      note: ing.note ?? '',
    })),
    steps: draft.steps.map((step) => ({ body: step.body })),
    tags: draft.tags ?? [],
  };
}

function mimeTypeFor(uri: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Infer a recipe draft from a dish photo via the server Vision LLM.
 * Throws VisionInferenceError on failure so the caller can fall back.
 */
export async function inferRecipeFromVision(args: {
  imageUri: string;
  context?: string;
}): Promise<VisionInferenceResult> {
  let imageBase64: string;
  try {
    imageBase64 = await FileSystem.readAsStringAsync(args.imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    throw new VisionInferenceError('画像の読み込みに失敗しました', false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_V1}/infer/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        mimeType: mimeTypeFor(args.imageUri),
        ...(args.context?.trim() ? { context: args.context.trim() } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new VisionInferenceError(`サーバーエラー (${res.status})`, res.status >= 500);
    }

    const result = (await res.json()) as ServerAgentResult;
    if (!result.ok || !result.data) {
      throw new VisionInferenceError(
        result.error?.message ?? '写真からレシピをつくれませんでした',
        result.error?.retryable ?? true,
        kindFromCode(result.error?.code),
      );
    }

    return {
      draft: toFormData(result.data),
      confidence: result.data.confidence,
      warnings: ['AIがつくったレシピです。分量・手順は必ず確認・調整してください。'],
    };
  } catch (err) {
    if (err instanceof VisionInferenceError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new VisionInferenceError('リクエストがタイムアウトしました', true);
    }
    throw new VisionInferenceError('インターネット接続を確認してください', true);
  } finally {
    clearTimeout(timer);
  }
}
