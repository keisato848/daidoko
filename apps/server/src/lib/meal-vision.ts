/**
 * Meal-consumption Vision — infer which ingredients a meal photo used up, so the
 * pantry can be decremented. Provider abstraction (default Gemini Flash). The
 * result is a best-effort, experimental estimate (see docs/買い物リスト・在庫設計.md §5.7).
 */
export interface MealVisionInput {
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

export class MealVisionConfigError extends Error {}
export class MealVisionRequestError extends Error {}

const SYSTEM_PROMPT = [
  'あなたは食事の写真から「使われた（消費された）食材」を推定する日本語の専門家です。',
  '写真の料理を特定し、その料理に一般的に使われる主な食材を列挙してください。',
  '細かい調味料より主要な食材（肉・魚・野菜・卵・主食など）を優先します。',
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
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
