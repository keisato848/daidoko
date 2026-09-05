/**
 * Meal-consumption Vision provider — infer consumed ingredients from a meal
 * photo via Gemini (BYOK direct) or the managed server (/infer/meal).
 * See docs/買い物リスト・在庫設計.md §5.7.
 */
import { isCategoryName } from '@daidoko/shared';

import { API_V1, GEMINI_MODEL } from '../config';
import { t } from '../i18n';
import { serverErrorFor } from './ai-error';
import { requestLocale, withOutputLanguage } from './ai-output-locale';
import { getUserApiKey } from './byok.service';
import { toInferImagePayload } from './image-payload';

/** t() 済みの文言だけを持つ（画面は message をそのまま出してよい）。 */
export class MealVisionError extends Error {
  readonly userVisible = true;
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'MealVisionError';
    this.retryable = retryable;
  }
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000];

const SYSTEM_PROMPT = [
  'あなたは食事の写真から「使われた（消費された）食材」を推定する日本語の専門家です。',
  '写真の料理を特定し、その料理に一般的に使われる主な食材を列挙してください。',
  // カテゴリ語の例示は誘い水になる（冷蔵庫写真設計 §9 と同根）。例は具体品名で
  '細かい調味料より主要な食材を優先します（例: 鶏もも肉・鮭・玉ねぎ・にんじん・卵・ごはん）。',
  '「調味料」「野菜」「肉」のようなカテゴリ名は食材として返しません。必ず具体的な品名で挙げます。',
  '分量(amount)は概算で任意。断定できないため confidence を自己申告します。',
  '料理・食品が写っていない場合は isMeal=false を返し、ingredients は空にします。',
  '食材名は一般的な総称（例: 卵、玉ねぎ、鶏肉）で出力します。',
].join('\n');

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isMeal: { type: 'BOOLEAN' },
    dish: { type: 'STRING' },
    ingredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, amount: { type: 'STRING' } },
        required: ['name'],
      },
    },
    confidence: { type: 'STRING' },
  },
  required: ['isMeal'],
};

export interface MealIngredient {
  name: string;
  amount: string | null;
}

export interface MealInference {
  isMeal: boolean;
  dish: string | null;
  ingredients: MealIngredient[];
}

interface MealVisionRaw {
  isMeal?: boolean;
  dish?: string;
  ingredients?: { name?: string; amount?: string }[];
}

export function normalizeMealRaw(raw: MealVisionRaw): MealInference {
  const ingredients: MealIngredient[] = Array.isArray(raw.ingredients)
    ? raw.ingredients
        .filter(
          (i): i is { name: string; amount?: string } =>
            typeof i?.name === 'string' && i.name.trim().length > 0,
        )
        // カテゴリ語（「調味料」等）は在庫の消費対象を特定できない — 除外する。
        // 食事写真の材料行には confidence が無いので、fridge のように「要確認へ
        // 落とす」形が取れない（shared isCategoryName・単体一致のみ）
        .filter((i) => !isCategoryName(i.name))
        .map((i) => ({ name: i.name.trim(), amount: i.amount?.trim() ? i.amount.trim() : null }))
    : [];
  return {
    isMeal: raw.isMeal === true,
    dish: typeof raw.dish === 'string' && raw.dish.trim() ? raw.dish.trim() : null,
    ingredients,
  };
}

async function inferViaByok(
  base64: string,
  mimeType: string,
  apiKey: string,
): Promise<MealInference> {
  const body = {
    systemInstruction: { parts: [{ text: withOutputLanguage(SYSTEM_PROMPT) }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: 'この食事で使われた食材を推定してください。' },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
  const url = `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let res: Response | null = null;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    if (BACKOFF_MS[attempt] > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok || !RETRYABLE_STATUS.has(res.status)) break;
  }
  if (!res) throw new MealVisionError(t('error.offline'), true);
  if (res.status === 429) throw new MealVisionError(t('ai.error.byokQuota'), false);
  if (!res.ok) {
    const info = serverErrorFor(res.status);
    throw new MealVisionError(info.message, info.retryable);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new MealVisionError(t('ai.error.noResult'), true);
  return normalizeMealRaw(JSON.parse(text));
}

async function inferViaServer(base64: string, mimeType: string): Promise<MealInference> {
  const res = await fetch(`${API_V1}/infer/meal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64, mimeType, locale: requestLocale() }),
  });
  if (!res.ok) {
    const info = serverErrorFor(res.status);
    throw new MealVisionError(info.message, info.retryable);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data?: MealVisionRaw;
    error?: { message?: string };
  };
  if (!json.ok || !json.data) {
    // サーバーの error.message は t() 済み相当（日本語/ロケール対応）だが、
    // 将来の変化に備えて欠けたら一般文言に倒す
    throw new MealVisionError(json.error?.message ?? t('ai.error.noResult'), true);
  }
  return normalizeMealRaw(json.data);
}

/** Infer consumed ingredients from a meal photo (BYOK if a key is set, else server). */
export async function inferMealFromVision(args: {
  localPath: string;
  mimeType: string;
}): Promise<MealInference> {
  // 送信前の縮小は共通ヘルパー（image-payload.ts）へ一本化（規約① — それまで
  // この経路だけカメラ原寸を送っており、冷蔵庫写真と同じ 400 の穴だった）
  const payload = await toInferImagePayload(args);
  const userKey = await getUserApiKey();
  return userKey
    ? inferViaByok(payload.imageBase64, payload.mimeType, userKey)
    : inferViaServer(payload.imageBase64, payload.mimeType);
}
