import { DEFAULT_OUTPUT_LOCALE, withOutputLanguage, type OutputLocale } from './output-locale.js';
/**
 * Recipe refinement — adjust an existing recipe from the cook's feedback.
 *
 * 「作ってみたら店のより甘かった」のような感想を受けて、レシピを店の味に近づける。
 * 設計は `docs/お店の味を再現設計.md` §5。
 *
 * 写真は任意。焦げ色・とろみ・色・量のような**言葉にしにくいズレ**は写真の方が正確に
 * 伝わるため、家で作った結果（cooked）と目標＝店の料理（target）を添えられる。
 * target はユーザーに撮らせず、R1 の「お店で食べた」記録からアプリが自動で添える。
 */

/** 添付写真の役割。**どちらの写真が「現状」でどちらが「目標」か**をモデルに伝える。 */
export type RefineImageRole = 'cooked' | 'target';

export interface RefineImage {
  imageBase64: string;
  mimeType: string;
  role: RefineImageRole;
}

export interface RefineIngredient {
  groupLabel?: string;
  name: string;
  amount?: string;
  note?: string;
}

/** 調整対象の現行レシピ。クライアントが持っているものをそのまま送る。 */
export interface RefineRecipeSnapshot {
  title: string;
  servings?: number;
  cookTimeMin?: number;
  description?: string;
  ingredients: RefineIngredient[];
  steps: { body: string }[];
  tags?: string[];
}

export interface RefineRecipeInput {
  recipe: RefineRecipeSnapshot;
  feedback: string;
  images?: RefineImage[];
  /** 出力言語。省略時は ja（既存の呼び出しは挙動が変わらない）。 */
  outputLocale?: OutputLocale;
}

/** Raw, unvalidated model output. The agent validates/normalizes it. */
export interface RefineRecipeRaw {
  /** 感想から「変えるべき点」を読み取れたか。false なら勝手に書き換えない */
  changed: boolean;
  /** 何をどう変えたか（changed=false のときは、なぜ変えられなかったか） */
  changeSummary?: string;
  title?: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients?: RefineIngredient[];
  steps?: { body?: string }[];
  tags?: string[];
}

export interface RecipeRefineProvider {
  refine(input: RefineRecipeInput): Promise<RefineRecipeRaw>;
}

export class RefineConfigError extends Error {}
export class RefineRequestError extends Error {}
/**
 * 上流（Gemini）の利用枠を使い切った場合。再試行しても当面回復しないため、
 * 「つながらない」ではなく「上限に達した」としてユーザーに伝える（Issue #120）。
 */
export class RefineQuotaError extends RefineRequestError {}

const SYSTEM_PROMPT = [
  'あなたは、家庭で作った料理をお店の味に近づける、日本語のプロの料理人です。',
  '既存のレシピと、作った人の感想（＋あれば写真）を受け取り、**感想で指示された点だけ**を直します。',
  '',
  '## 最も重要な制約: 指示された点だけを変える',
  '- 感想と無関係な材料・手順は、**一字一句そのまま**出力する。言い回しを整えることもしない。',
  '- 材料の並び順・グループ（groupLabel）・手順の順序は変えない。',
  '  変える必要があるときは、その理由を changeSummary に書く。',
  '- 料理そのものが別物だと分かる場合を除き、title は変えない。',
  '- 変更は最小限にする。「ついでに良くする」ことをしてはならない。',
  '  ユーザーは自分のレシピを育てており、勝手な書き換えは信頼を壊す。',
  '',
  '## レシピの不備は直さない',
  '手順に出てくるのに材料表にない、分量が書かれていない、といった不備に気づいても、',
  '**感想と関係がなければ直さない**。気づいた点は changeSummary の末尾に一言添えるだけにする。',
  'ユーザーが意図してそう書いている可能性があり、頼まれていない補完は書き換えと同じである。',
  '',
  '## 変えられないときは変えない',
  '感想から「何をどう変えるか」が読み取れない場合（例: 「おいしかった」「また作る」のような',
  '感想のみ、内容が空、レシピと無関係）は changed=false とし、changeSummary に',
  '**何が足りないか**を一文で書く。推測で書き換えてはならない。',
  '',
  '## 写真の使い方（添付されている場合）',
  '- role=cooked: 家で作った結果。**現状**を表す。',
  '- role=target: お店の料理。**目指す状態**を表す。',
  '- 2枚あるときは、見た目の差（焼き色・とろみ・色の濃さ・具の大きさ・量）を根拠に使う。',
  '- **写真に写らないもの（味・香り・塩気・辛さ）は、感想テキストだけを根拠にする。**',
  '  写真から味を推測してはならない。',
  '',
  '## 直し方',
  '- 分量を変えるときは具体値で（「少し減らす」ではなく「大さじ1 → 小さじ2」）。',
  '- 味の方向を変えるとき、材料を足すより**既存の材料の配合を変える**方を優先する。',
  '- 手順で解決できるもの（火加減・加熱時間・入れる順番・水分の飛ばし方）は、',
  '  材料をいじらず手順を直す。',
  '- 家庭の台所で実行できる範囲に収める。',
  '',
  '## changeSummary',
  '何をどう変えたかを、ユーザーが読んで納得できる日本語で 1〜3 文で書く。',
  '「甘みを抑えるため、みりんを大さじ2から大さじ1に減らしました」のように、',
  '**変更内容と理由をセット**で書く。',
  '',
  'ingredients と steps は、変更後の**レシピ全体**を返す（差分ではない）。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    changed: { type: 'BOOLEAN' },
    changeSummary: { type: 'STRING' },
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
  },
  // ingredients / steps を必須にする。**これが無いとモデルが省ける**。
  // 実機で、材料18・手順6のレシピに対して changed=true と changeSummary だけ返し、
  // 材料・手順が空の応答が返った（→「調整結果をレシピに変換できませんでした」）。
  // changed=false のときも埋まるが、その場合は使わないので害はない。
  required: ['changed', 'changeSummary', 'ingredients', 'steps'],
  propertyOrdering: [
    'changed',
    'changeSummary',
    'title',
    'titleReading',
    'description',
    'servings',
    'cookTimeMin',
    'ingredients',
    'steps',
    'tags',
  ],
};

/** 構造化出力のスキーマ（テストから必須項目を固定するために公開する）。 */
export function buildRefineResponseSchema(): typeof GEMINI_RESPONSE_SCHEMA {
  return GEMINI_RESPONSE_SCHEMA;
}

/** モデルに渡す現行レシピ。JSON にして user メッセージへ入れる。 */
export function buildRecipeText(recipe: RefineRecipeSnapshot): string {
  return JSON.stringify(
    {
      title: recipe.title,
      ...(recipe.servings !== undefined && { servings: recipe.servings }),
      ...(recipe.cookTimeMin !== undefined && { cookTimeMin: recipe.cookTimeMin }),
      ...(recipe.description !== undefined && { description: recipe.description }),
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      ...(recipe.tags !== undefined && { tags: recipe.tags }),
    },
    null,
    2,
  );
}

/** 添付写真の役割を、モデルに分かる形で説明する行。 */
export function buildImageLegend(images: RefineImage[]): string {
  if (images.length === 0) return '';
  const lines = images.map((image, index) => {
    const label = image.role === 'cooked' ? '家で作った結果（現状）' : 'お店の料理（目指す状態）';
    return `写真${index + 1}: ${label}`;
  });
  return `\n\n添付写真:\n${lines.join('\n')}`;
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Google Gemini (Flash) implementation via the REST generateContent API. */
export class GeminiRecipeRefineProvider implements RecipeRefineProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new RefineConfigError('GEMINI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async refine(input: RefineRecipeInput): Promise<RefineRecipeRaw> {
    const images = input.images ?? [];
    const userText = [
      '次のレシピを、感想にしたがって直してください。',
      '',
      '## 現在のレシピ',
      buildRecipeText(input.recipe),
      '',
      '## 作った人の感想',
      input.feedback.trim(),
      buildImageLegend(images),
    ].join('\n');

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
            ...images.map((image) => ({
              inlineData: { mimeType: image.mimeType, data: image.imageBase64 },
            })),
            { text: userText },
          ],
        },
      ],
      generationConfig: {
        // 写真レシピ（0.4）より低い。既存レシピを保つことが目的で、創作性は不要。
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        // レシピ全体を返させるので、材料・手順が多いと出力が長い。既定のままだと
        // 途中で打ち切られて中身の無い応答になる（実機で被弾）。
        maxOutputTokens: 8192,
        // **思考は切る。** 思考トークンは出力枠を食う一方、この処理は「言われた点だけ直す」
        // 制約付きの編集で、深い推論を必要としない（写真レシピとは性質が違う）。
        // コストも下がる（R0 の実測では思考が出力の大半を占めていた）。
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    const url = `${GEMINI_ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`;
    let lastError = '';
    // 429 は再試行対象だが、使い切りの 429 は待っても回復しない。
    // 最後の失敗が 429 だったかを覚えておき、終了時に区別して投げる。
    let lastStatusWasQuota = false;

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
        lastStatusWasQuota = res.status === 429;
        if (RETRYABLE_STATUS.has(res.status)) continue;
        throw new RefineRequestError(lastError);
      }
      lastStatusWasQuota = false;

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new RefineRequestError('Gemini returned no content');

      try {
        return JSON.parse(text) as RefineRecipeRaw;
      } catch {
        throw new RefineRequestError('Gemini returned non-JSON content');
      }
    }

    const summary = `Gemini unavailable after ${MAX_ATTEMPTS} attempts: ${lastError}`;
    throw lastStatusWasQuota ? new RefineQuotaError(summary) : new RefineRequestError(summary);
  }
}
