/**
 * Vision recipe inference — infer an editable recipe draft from a dish photo.
 *
 * Provider abstraction so the model backend (default: Google Gemini Flash) can
 * be swapped via env without touching the agent/route. The provider returns a
 * raw draft object which the agent validates against `recipeDraftSchema`.
 */

export interface VisionRecipeImage {
  imageBase64: string;
  mimeType: string;
}

export interface VisionRecipeInput {
  imageBase64: string;
  mimeType: string;
  context?: string;
  /**
   * 追加の写真（断面・メニュー等）。**評価ハーネス専用**で、本番の
   * `POST /api/v1/infer/photo` は単数の画像しか受け取らない。
   * 複数枚が精度に効くかを測ってから本番スキーマを拡張する
   * （`docs/レシピ推論の評価設計.md` §8）。
   */
  extraImages?: VisionRecipeImage[];
}

/** なぜレシピ化できなかったか。v1 プロンプトのみが返す（`docs/レシピ推論の評価設計.md` §7-2）。 */
export type VisionRejectReason =
  | 'not_food'
  | 'ingredients_only'
  | 'text_page'
  | 'too_dark'
  | 'blurry'
  | 'too_far';

/** ユーザーが次に何をすれば精度が上がるか。v1 プロンプトのみが返す。 */
export type VisionImprovementHint =
  | 'add_dish_name'
  | 'add_menu_photo'
  | 'add_cross_section'
  | 'brighter'
  | 'closer';

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
  /** v1 のみ。v0 では常に undefined（既存の呼び出し側は無視してよい）。 */
  rejectReason?: VisionRejectReason;
  /** v1 のみ。最大 2 件。 */
  improvementHints?: VisionImprovementHint[];
}

/** プロンプトの版。既定は v0（現行の本番挙動を変えないため）。 */
export type PromptVariant = 'v0' | 'v1';

export interface VisionRecipeProvider {
  infer(input: VisionRecipeInput): Promise<VisionRecipeRaw>;
}

export class VisionConfigError extends Error {}
export class VisionRequestError extends Error {}

const SYSTEM_PROMPT_V0 = [
  'あなたは料理写真からレシピを再現する、日本語のプロの料理人です。',
  '与えられた料理の写真と（あれば）感想・文脈テキストから、家庭で再現できる現実的なレシピを推論します。',
  '写真に料理・食品が写っていない場合は isDish=false を返し、他のフィールドは空にしてください。',
  '材料は具体的な分量（例: 「200g」「大さじ1」）を、手順は調理順に具体的に記述します。',
  '写真だけでは確定できない分量・加熱時間は一般的な目安を用い、断定しすぎないこと。',
  '感想・文脈テキストがある場合は、味の方向性・辛さ・地域性・量に優先的に反映します。',
  'confidence は、料理の特定しやすさと写真の鮮明さに応じて high / medium / low を自己申告します。',
  'すべて自然な日本語で出力します。',
].join('\n');

/**
 * v1: 「お店で出た料理を家庭の台所で再現する」に特化した版。
 * 設計は `docs/レシピ推論の評価設計.md` §7（プロンプト v1）と §7-2（ガードレール）。
 * v0 との差分は、判定を先に行うこと・思考の順序・店名の活用・家庭への翻訳・
 * 推定の明示・confidence の基準・改善ヒント。
 */
const SYSTEM_PROMPT_V1 = [
  'あなたは、お店で出た料理を家庭の台所で再現する、日本語のプロの料理人です。',
  '',
  '## 手順0: まず、レシピ化できる写真かを判定する',
  '次のいずれかに当てはまる場合は isDish=false とし、rejectReason を返す。レシピは書かない。',
  '- not_food: 料理・食品が写っていない（風景・人物・動物・スクリーンショット等）',
  '- ingredients_only: 調理前の食材や商品パッケージだけが写っている（例: じゃがいもが3個）',
  '- text_page: レシピ本・手書きメモ・印刷物など文字が主体',
  '- too_dark: 暗すぎて色や質感が判別できない',
  '- blurry: ぶれていて輪郭が判別できない',
  '- too_far: 料理が小さく写りすぎていて詳細が分からない',
  '**迷ったら false にする。** 曖昧な写真から推測でレシピを作ってはならない。',
  '',
  '## 手順1〜4: レシピ化できる場合',
  '1. 料理を特定する（名前・ジャンル・地域）。補足テキストに店名やメニュー名があれば、',
  '   写真よりも優先してここで使う（料理の特定において最も強い手がかりであるため）。',
  '2. その料理の標準的な作り方を想起する。',
  '3. 写真から読み取れる差分（具材・色・とろみ・焼き色・盛り付け）で 2 を補正する。',
  '4. 家庭の台所で作れる形に翻訳する。',
  '',
  '## 家庭への翻訳（最も重要）',
  '- 業務用の器具を前提にしない。中華レンジの強火・コンベクションオーブン・真空調理・',
  '  大型フライヤーなどは、家庭のコンロ・フライパン・オーブン・少量の揚げ油での代替手順に置き換える。',
  '- 入手困難な食材は日本のスーパーで買えるもので代用し、note に本来の食材を書く。',
  '- 何日もかかる仕込み（出汁の作り置き・長時間の熟成）は、当日でも近づく方法を書く。',
  '',
  '## 見えないものの扱い',
  '下味・隠し味・出汁の種類・油の種類は写真から確定できない。一般的な前提を置いたうえで、',
  'その材料の note に「推定」と明記する。断定しない。',
  '',
  '## confidence の基準（自己申告ではなく、この基準で判定する）',
  '- high: 料理名を特定でき、主要な材料がほぼ確定できる',
  '- medium: 料理の系統は特定できるが、配合や具材に幅がある',
  '- low: 系統の推測どまり、または写真が不鮮明',
  '',
  '## improvementHints（最大2件・当てはまるものだけ）',
  'ユーザーが次に何をすれば精度が上がるかを、次から選ぶ。当てはまらなければ空配列にする。',
  '- add_dish_name: 料理名が分かれば特定できる',
  '- add_menu_photo: メニューの文字が読めれば確実になる',
  '- add_cross_section: 断面が見えれば中身の具材が分かる',
  '- brighter: もっと明るく撮れば判別できる',
  '- closer: もっと寄れば質感が分かる',
  '',
  '材料は具体的な分量（例: 「200g」「大さじ1」）を、手順は調理順に具体的に記述する。',
  'すべて自然な日本語で出力する。',
].join('\n');

export function buildSystemPrompt(variant: PromptVariant): string {
  return variant === 'v1' ? SYSTEM_PROMPT_V1 : SYSTEM_PROMPT_V0;
}

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

/**
 * v1 用スキーマ。rejectReason / improvementHints を足しただけで、既存フィールドは同一。
 * required は増やさない（拒否時に title / ingredients / steps を空にできるようにするため、
 * v0 と同じ required のままだとモデルが埋めようとする — そこで v1 では isDish のみ必須にする）。
 */
const GEMINI_RESPONSE_SCHEMA_V1 = {
  ...GEMINI_RESPONSE_SCHEMA,
  properties: {
    ...GEMINI_RESPONSE_SCHEMA.properties,
    rejectReason: {
      type: 'STRING',
      enum: ['not_food', 'ingredients_only', 'text_page', 'too_dark', 'blurry', 'too_far'],
    },
    improvementHints: {
      type: 'ARRAY',
      items: {
        type: 'STRING',
        enum: ['add_dish_name', 'add_menu_photo', 'add_cross_section', 'brighter', 'closer'],
      },
    },
  },
  required: ['isDish'],
  propertyOrdering: [
    'isDish',
    'rejectReason',
    'title',
    'titleReading',
    'description',
    'servings',
    'cookTimeMin',
    'ingredients',
    'steps',
    'tags',
    'confidence',
    'improvementHints',
  ],
};

export function buildResponseSchema(variant: PromptVariant): object {
  return variant === 'v1' ? GEMINI_RESPONSE_SCHEMA_V1 : GEMINI_RESPONSE_SCHEMA;
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 30_000;
// Gemini Flash returns transient 503 (high demand) / 429 (rate) fairly often;
// these are retryable. Back off between attempts.
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Google Gemini (Flash) implementation via the REST generateContent API. */
export class GeminiVisionRecipeProvider implements VisionRecipeProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly variant: PromptVariant;

  constructor(opts?: { apiKey?: string; model?: string; variant?: PromptVariant }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) {
      throw new VisionConfigError('GEMINI_API_KEY is not configured');
    }
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
    // 既定は v0。本番（infer ルート）は変種を指定しないため挙動が変わらない。
    this.variant = opts?.variant ?? 'v0';
  }

  async infer(input: VisionRecipeInput): Promise<VisionRecipeRaw> {
    const userText = input.context?.trim()
      ? `この料理のレシピを推論してください。\n補足・感想: ${input.context.trim()}`
      : 'この料理のレシピを推論してください。';

    const imageParts = [
      { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
      ...(input.extraImages ?? []).map((image) => ({
        inlineData: { mimeType: image.mimeType, data: image.imageBase64 },
      })),
    ];

    const body = {
      systemInstruction: { parts: [{ text: buildSystemPrompt(this.variant) }] },
      contents: [
        {
          role: 'user',
          parts: [...imageParts, { text: userText }],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: buildResponseSchema(this.variant),
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
        // Network/timeout errors are transient — retry.
        lastError = err instanceof Error ? err.message : 'request failed';
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        lastError = `Gemini responded ${res.status}: ${detail.slice(0, 200)}`;
        if (RETRYABLE_STATUS.has(res.status)) continue;
        throw new VisionRequestError(lastError);
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

    throw new VisionRequestError(`Gemini unavailable after ${MAX_ATTEMPTS} attempts: ${lastError}`);
  }
}
