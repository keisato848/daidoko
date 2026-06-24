/**
 * Vision recipe inference — infer an editable recipe draft from a dish photo.
 *
 * Provider abstraction so the model backend (default: Google Gemini Flash) can
 * be swapped via env without touching the agent/route. The provider returns a
 * raw draft object which the agent validates against `recipeDraftSchema`.
 */

export interface VisionRecipeInput {
  imageBase64: string;
  mimeType: string;
  context?: string;
}

/** Raw, unvalidated model output. The agent validates/normalizes it. */
export interface VisionRecipeRaw {
  isDish: boolean;
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

export interface VisionRecipeProvider {
  infer(input: VisionRecipeInput): Promise<VisionRecipeRaw>;
}

export class VisionConfigError extends Error {}
export class VisionRequestError extends Error {}

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

// Gemini structured-output schema (OpenAPI subset). Mirrors the shared
// RecipeDraft shape plus an isDish guard.
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
  propertyOrdering: [
    'isDish',
    'title',
    'titleReading',
    'description',
    'servings',
    'cookTimeMin',
    'ingredients',
    'steps',
    'tags',
    'confidence',
  ],
};

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 30_000;

/** Google Gemini (Flash) implementation via the REST generateContent API. */
export class GeminiVisionRecipeProvider implements VisionRecipeProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) {
      throw new VisionConfigError('GEMINI_API_KEY is not configured');
    }
    this.apiKey = apiKey;
    this.model = opts?.model ?? process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';
  }

  async infer(input: VisionRecipeInput): Promise<VisionRecipeRaw> {
    const userText = input.context?.trim()
      ? `この料理のレシピを推論してください。\n補足・感想: ${input.context.trim()}`
      : 'この料理のレシピを推論してください。';

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
            { text: userText },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${GEMINI_ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new VisionRequestError(
        err instanceof Error ? `Gemini request failed: ${err.message}` : 'Gemini request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new VisionRequestError(`Gemini responded ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new VisionRequestError('Gemini returned no content');
    }

    try {
      return JSON.parse(text) as VisionRecipeRaw;
    } catch {
      throw new VisionRequestError('Gemini returned non-JSON content');
    }
  }
}
