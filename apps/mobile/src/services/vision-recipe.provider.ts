/**
 * Vision recipe provider — infers an editable recipe draft from a dish photo.
 *
 * Two paths, chosen at call time:
 *  - BYOK: if the user set their own Gemini key, call Gemini DIRECTLY from the
 *    device (no server, no freemium quota — the user pays Google).
 *  - Managed: otherwise POST to our server (POST /api/v1/infer/photo), which
 *    holds the key and applies the freemium cost caps.
 *
 * The image is read locally and base64-encoded. On any failure this throws, so
 * the A2 agent can fall back to the on-device heuristic / OCR path.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { API_V1, GEMINI_MODEL } from '../config';
import { getUserApiKey } from './byok.service';
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

const VISION_WARNINGS = ['AIがつくったレシピです。分量・手順は必ず確認・調整してください。'];

// ── BYOK: direct Gemini call from the device (the user's own key) ───────────
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const GEMINI_BACKOFF_MS = [0, 1_500, 4_000];

const SYSTEM_PROMPT = [
  'あなたは料理写真からレシピを再現する、日本語のプロの料理人です。',
  '与えられた料理の写真と（あれば）感想・文脈テキストから、家庭で再現できる現実的なレシピを推論します。',
  '写真に料理・食品が写っていない場合は isDish=false を返し、他のフィールドは空にしてください。',
  '材料は具体的な分量（例: 「200g」「大さじ1」）を、手順は調理順に具体的に記述します。',
  '写真だけでは確定できない分量・加熱時間は一般的な目安を用い、断定しすぎないこと。',
  '感想・文脈テキストがある場合は、味の方向性・辛さ・地域性・量に優先的に反映します。',
  'confidence は、料理の特定しやすさと写真の鮮明さに応じて high / medium / low を自己申告します。',
  'すべて自然な日本語で出力します。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isDish: { type: 'BOOLEAN' },
    title: { type: 'STRING' },
    titleReading: { type: 'STRING' },
    description: { type: 'STRING' },
    servings: { type: 'INTEGER' },
    cookTimeMin: { type: 'INTEGER' },
    ingredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          groupLabel: { type: 'STRING' },
          name: { type: 'STRING' },
          amount: { type: 'STRING' },
          note: { type: 'STRING' },
        },
        propertyOrdering: ['groupLabel', 'name', 'amount', 'note'],
      },
    },
    steps: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { body: { type: 'STRING' } },
        propertyOrdering: ['body'],
      },
    },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
  },
  required: ['isDish', 'title', 'ingredients', 'steps', 'confidence'],
};

interface GeminiRecipeRaw {
  isDish?: boolean;
  title?: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients?: { groupLabel?: string; name?: string; amount?: string; note?: string }[];
  steps?: { body?: string }[];
  tags?: string[];
  confidence?: 'high' | 'medium' | 'low';
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function cleanPositiveInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded < min || rounded > max ? undefined : rounded;
}

/** Normalize raw Gemini output to a server-shaped draft (null if unusable). */
export function normalizeGeminiRaw(raw: GeminiRecipeRaw): ServerRecipeDraft | null {
  const title = cleanString(raw.title, 100);
  const ingredients = (raw.ingredients ?? [])
    .map((item): ServerIngredient | null => {
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
    .filter((item): item is ServerIngredient => item !== null);

  const steps = (raw.steps ?? [])
    .map((item) => {
      const body = cleanString(item?.body, 500);
      return body ? { body } : null;
    })
    .filter((item): item is { body: string } => item !== null);

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function inferViaByok(
  imageBase64: string,
  mimeType: string,
  context: string | undefined,
  apiKey: string,
): Promise<VisionInferenceResult> {
  const userText = context?.trim()
    ? `この料理のレシピを推論してください。\n補足・感想: ${context.trim()}`
    : 'この料理のレシピを推論してください。';
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: userText }],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  };
  const url = `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let lastError = '';
  for (let attempt = 0; attempt < GEMINI_BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(GEMINI_BACKOFF_MS[attempt] ?? 4_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      lastError = 'network';
      clearTimeout(timer);
      continue;
    }
    clearTimeout(timer);

    if (!res.ok) {
      lastError = `Gemini ${res.status}`;
      if (GEMINI_RETRYABLE_STATUS.has(res.status)) continue;
      // 400/401/403 are usually a bad/disabled key — not retryable, not transient.
      throw new VisionInferenceError('APIキーを確認してください（無効・権限不足の可能性）', false);
    }

    const json = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    } | null;
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new VisionInferenceError('AIから結果を取得できませんでした', true);

    let raw: GeminiRecipeRaw;
    try {
      raw = JSON.parse(text) as GeminiRecipeRaw;
    } catch {
      throw new VisionInferenceError('AIの応答を解析できませんでした', true);
    }
    if (!raw.isDish) {
      throw new VisionInferenceError(
        '写真から料理を認識できませんでした。料理がはっきり写った写真でお試しください。',
        false,
        'not_a_dish',
      );
    }
    const draft = normalizeGeminiRaw(raw);
    if (!draft) throw new VisionInferenceError('レシピ下書きに変換できませんでした', true);
    return { draft: toFormData(draft), confidence: draft.confidence, warnings: VISION_WARNINGS };
  }
  throw new VisionInferenceError(`AIにつながりませんでした（${lastError}）`, true, 'transient');
}

async function inferViaServer(
  imageBase64: string,
  mimeType: string,
  context: string | undefined,
): Promise<VisionInferenceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_V1}/infer/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        mimeType,
        ...(context?.trim() ? { context: context.trim() } : {}),
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
      warnings: VISION_WARNINGS,
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

/**
 * Infer a recipe draft from a dish photo. Uses the user's own Gemini key
 * (BYOK, direct) when set, else the managed server. Throws VisionInferenceError
 * on failure so the caller can fall back.
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

  const mimeType = mimeTypeFor(args.imageUri);
  const userKey = await getUserApiKey();
  if (userKey) {
    return inferViaByok(imageBase64, mimeType, args.context, userKey);
  }
  return inferViaServer(imageBase64, mimeType, args.context);
}
