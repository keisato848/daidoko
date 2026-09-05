import { DEFAULT_OUTPUT_LOCALE, withOutputLanguage, type OutputLocale } from './output-locale.js';
import { thinkingConfigFragment } from './thinking-budget.js';
import { isCategoryItemName } from './fridge-vision.js';
/**
 * Meal-consumption Vision — infer which ingredients a meal photo used up, so the
 * pantry can be decremented. Provider abstraction (default Gemini Flash). The
 * result is a best-effort, experimental estimate (see docs/買い物リスト・在庫設計.md §5.7).
 */
export interface MealVisionInput {
  /** 出力言語。省略時は ja（既存の呼び出しは挙動が変わらない）。 */
  outputLocale?: OutputLocale;
  imageBase64: string;
  mimeType: string;
}

export interface MealVisionRaw {
  isMeal: boolean;
  dish?: string;
  ingredients?: { name?: string; amount?: string }[];
  confidence?: 'high' | 'medium' | 'low';
}

export interface MealVisionProvider {
  infer(input: MealVisionInput): Promise<MealVisionRaw>;
}

/**
 * ルートが返す前の検証（それまで生出力を素通ししていた — 水平展開規約②）。
 * カテゴリ語（「調味料」等）の材料は在庫の消費対象を特定できないので**除外**する。
 * 材料行には confidence が無く、fridge のように「要確認へ落とす」形が取れない。
 */
export function sanitizeMealRaw(raw: MealVisionRaw): MealVisionRaw {
  const ingredients = Array.isArray(raw.ingredients)
    ? raw.ingredients.filter(
        (item) =>
          typeof item?.name === 'string' && item.name.trim() && !isCategoryItemName(item.name),
      )
    : [];
  return { ...raw, ingredients };
}

export class MealVisionConfigError extends Error {}
export class MealVisionRequestError extends Error {}

const SYSTEM_PROMPT = [
  'あなたは食事の写真から「使われた（消費された）食材」を推定する日本語の専門家です。',
  '写真の料理を特定し、その料理に一般的に使われる主な食材を列挙してください。',
  // カテゴリ語の例示は誘い水になる（冷蔵庫写真設計 §9 と同根・2026-09-05）。例は具体品名で
  '細かい調味料より主要な食材を優先します（例: 鶏もも肉・鮭・玉ねぎ・にんじん・卵・ごはん）。',
  '「調味料」「野菜」「肉」のようなカテゴリ名は食材として返しません。必ず具体的な品名で挙げます。',
  '分量(amount)は概算で任意。写真だけでは断定できないため confidence を自己申告します。',
  '料理・食品が写っていない場合は isMeal=false を返し、ingredients は空にします。',
  'すべて自然な日本語で、食材名は一般的な総称（例: 卵、玉ねぎ、鶏肉）で出力します。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
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
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
  },
  required: ['isMeal'],
} as const;

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiMealVisionProvider implements MealVisionProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new MealVisionConfigError('GEMINI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async infer(input: MealVisionInput): Promise<MealVisionRaw> {
    const body = {
      systemInstruction: {
        parts: [
          {
            text: withOutputLanguage(SYSTEM_PROMPT, input.outputLocale ?? DEFAULT_OUTPUT_LOCALE),
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
            { text: 'この食事で使われた食材を推定してください。' },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        // 写真から食材を読み取る抽出寄りの処理（`thinking-budget.ts`）。
        ...thinkingConfigFragment(),
      },
    };

    const url = `${GEMINI_ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`;
    let lastError = '';

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(BACKOFF_MS[attempt] ?? 8_000);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'request failed';
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        lastError = `Gemini responded ${res.status}: ${detail.slice(0, 200)}`;
        if (RETRYABLE_STATUS.has(res.status)) continue;
        throw new MealVisionRequestError(lastError);
      }

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        lastError = 'empty model response';
        continue;
      }
      return JSON.parse(text) as MealVisionRaw;
    }

    throw new MealVisionRequestError(lastError || 'Gemini request failed');
  }
}
