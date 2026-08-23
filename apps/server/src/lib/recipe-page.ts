/**
 * Recipe Page Vision — 紙面（レシピ本・食品パッケージ・手書きメモ・切り抜き）に
 * **書かれているレシピを読み取って**構造化する。
 *
 * ## なぜ端末内 OCR ではなくこれなのか
 *
 * 「文字入り画像から作成」は端末内 ML Kit で読んでいたが、**版面が少しでも複雑だと成立しない**
 * ことが実測で確定した（`docs/レシピ推論の評価設計.md` §10）。ML Kit の `rawText` は
 * レイアウトを保存しないため、イラスト脇の狭い段に組まれた 1 文が 4 行に折り返されると、
 * 手順が 4 つの断片に割れる。解像度を上げても直らない（文字の誤読が減るだけ）。
 * 直すには版面解析を自作することになり、多様な紙面すべてに効かせるのは現実的でない。
 *
 * ## `vision-recipe`（料理写真）と分ける理由
 *
 * 同じ「写真からレシピ」でも**タスクが正反対**なので、プロンプトも判定も共有できない。
 *
 * | | vision-recipe（料理写真） | recipe-page（この file） |
 * | --- | --- | --- |
 * | 入力 | 出来上がった料理 | 文字が書かれた紙面 |
 * | やること | **推測して作る**（見えない下味を補う） | **書いてあるとおりに写す**（補わない） |
 * | 弾くもの | 文字主体の紙面（`text_page`） | レシピが書かれていない紙面 |
 *
 * `vision-recipe` の v1 プロンプトは R0 で品質を測ってあるので触らない
 * （`docs/レシピ推論の評価設計.md`）。こちらは独立して測る。
 *
 * ## 最初から複数枚
 *
 * 紙面は**表に料理名・裏に材料と作り方**のように分かれるのが普通で、1 枚では完結しない
 * （実測: S&B シーズニング。表に「アンチョビポテト」、裏に材料と作り方）。
 * 見開きのレシピ本も同じ。1 枚に限ると使えない場面が多いので、最初から複数枚を受ける。
 */
import {
  DEFAULT_OUTPUT_LOCALE,
  DEFAULT_UNIT_SYSTEM,
  withOutputLanguage,
  withUnitSystem,
  type OutputLocale,
  type OutputUnitSystem,
} from './output-locale.js';
import { thinkingConfigFragment } from './thinking-budget.js';

export interface RecipePageImage {
  imageBase64: string;
  mimeType: string;
}

export interface RecipePageInput {
  /** 同じレシピの紙面。順序は利用者が撮った順（表 → 裏 / 見開きの左 → 右） */
  images: RecipePageImage[];
  /** 料理名など、利用者が補える手がかり（任意） */
  context?: string;
  outputLocale?: OutputLocale;
  unitSystem?: OutputUnitSystem;
}

/** なぜレシピにできなかったか。利用者への案内を分けるために持つ。 */
export type RecipePageRejectReason =
  /** 文字は読めたが、レシピ（材料と作り方）が書かれていない */
  | 'no_recipe'
  /** ぶれ・暗さ・小ささで文字が読めない */
  | 'unreadable'
  /** 文字がほとんど無い（料理の写真だけ等） */
  | 'no_text';

/** モデルの生出力。検証は agent が行う。 */
export interface RecipePageRaw {
  /** レシピを読み取れたか。false なら他は空で rejectReason が入る */
  found: boolean;
  title?: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients?: { groupLabel?: string; name?: string; amount?: string; note?: string }[];
  steps?: { body?: string }[];
  tags?: string[];
  confidence?: 'high' | 'medium' | 'low';
  rejectReason?: RecipePageRejectReason;
}

export interface RecipePageProvider {
  read(input: RecipePageInput): Promise<RecipePageRaw>;
}

export class RecipePageConfigError extends Error {}
export class RecipePageRequestError extends Error {}

/**
 * **転記に徹させる**プロンプト。料理写真の推論と最も違うのはここで、
 * 「書いていないことを書かない」を最優先の制約に置く。
 *
 * 各項目は、今日の実測で実際に壊れた点に対応している
 * （AQUOS + ML Kit / S&B シーズニング裏面・2026-08-23）:
 * - 折り返しの結合 … 1 文が 4 つの手順に割れていた
 * - リーダーの扱い … 「じゃがいも……中2個」の分量が取れなかった
 * - ノイズの除外 … 原材料表示・賞味期限・「やけどに注意」が材料と手順に混ざっていた
 * - 見出しの選び方 … 「冷凍素材にも」「開け口から…」が料理名になっていた
 */
const SYSTEM_PROMPT = [
  'あなたは、紙面に書かれたレシピを正確に書き写す編集者です。',
  '写真に写っているレシピを、**書かれているとおりに**構造化して返します。',
  '',
  '## 最優先の制約: 書いていないことを書かない',
  '- 紙面に無い材料・分量・手順を**推測で補ってはいけません**。',
  '- 分量が書かれていない材料は、amount を空にします。埋めてはいけません。',
  '- 下味・隠し味の推定を note に書いてはいけません。ここは転記であって創作ではありません。',
  '- 読めなかった文字は、その部分を飛ばします。当て推量で埋めないでください。',
  '',
  '## 手順0: レシピが写っているかを判定する',
  '次のときは found=false とし、rejectReason を返します。レシピは書きません。',
  '- no_text: 文字がほとんど写っていない（料理や物の写真だけ）',
  '- unreadable: ぶれ・暗さ・小ささで文字が判読できない',
  '- no_recipe: 文字は読めるが、材料と作り方が書かれていない',
  '  （商品パッケージの表・広告・栄養成分表示だけ、など）',
  '**材料か作り方のどちらかが読み取れれば found=true** にします。両方揃っている必要はありません。',
  '',
  '## 複数枚は 1 つのレシピに統合する',
  '写真が複数あるときは、**同じレシピの別の面**（パッケージの表と裏、本の見開き、',
  '続きのページ）として扱い、**1 つのレシピにまとめます**。',
  '- 料理名は、それが書かれている面から取ります。',
  '- 材料と作り方は、書かれている面から取ります。',
  '- 同じ内容が複数の面に写っている場合は、重複させずに 1 回だけ書きます。',
  '',
  '## 紙面の読み方',
  '- **折り返しは 1 文につなぎます。** 紙面は幅の狭い段に組まれ、1 つの手順が何行にも',
  '  折り返されます。行ごとに分けず、文として完結する単位でまとめてください。',
  '- **点線（リーダー）は材料名と分量の区切りです。**',
  '  「じゃがいも(くし形切り)……中2個(300g)」は name=「じゃがいも(くし形切り)」、',
  '  amount=「中2個(300g)」です。',
  '- 見出しに人数が付いている場合（「材料(2人前)」）は、servings に入れ、見出しは材料に含めません。',
  '- イラストや図の中の番号（①②③）は手順の番号です。手順の本文には含めません。',
  '',
  '## 料理名の選び方',
  '- 紙面の**いちばん大きな見出し**、または商品名を料理名にします。',
  '- キャッチコピー・注意書き・ブランド名を料理名にしてはいけません。',
  '  （「冷凍素材にも」「開け口から、矢印の方向に引いて開けてください」「SPICE&HERB」などは料理名ではありません）',
  '- 料理名が紙面のどこにも無い場合は、title を空にします。作ってはいけません。',
  '',
  '## 材料と手順に入れてはいけないもの',
  '- 原材料表示・栄養成分表示・賞味期限・保存方法・加工者・問い合わせ先・バーコードの数字',
  '- 「やけどに注意」などの注意書き（手順の本文に自然に含まれている場合を除く）',
  '- 商品の宣伝文・アレンジの誘導・QR コードの説明',
  '',
  '## confidence の基準',
  '- high: 材料と作り方の両方が、欠けなく読み取れた',
  '- medium: どちらかに読み取れない箇所がある',
  '- low: 断片的にしか読み取れていない',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
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
    rejectReason: { type: 'STRING', enum: ['no_recipe', 'unreadable', 'no_text'] },
  },
  required: ['found'],
} as const;

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * 紙面の読み取りは待たせてよい処理ではない（利用者は結果画面を見て待っている）。
 * 料理写真と同じ 20 秒 × 3 にする。複数枚だと入力が増えるぶん遅くなるので、
 * 1 枚あたりではなく全体で見る。
 */
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000];

/** 最悪ケースの所要時間（ミリ秒）。テストが上限を見張るために公開する。 */
export const RECIPE_PAGE_RETRY_BUDGET_MS =
  REQUEST_TIMEOUT_MS * MAX_ATTEMPTS +
  BACKOFF_MS.slice(0, MAX_ATTEMPTS).reduce((sum, ms) => sum + ms, 0);

/** 1 リクエストで受ける紙面の枚数。表裏＋見開きで足りる範囲に絞る。 */
export const MAX_RECIPE_PAGE_IMAGES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUserText(input: RecipePageInput): string {
  const lines = [
    input.images.length > 1
      ? `この ${input.images.length} 枚は同じレシピの別の面です。1 つのレシピにまとめて読み取ってください。`
      : 'この写真に書かれているレシピを読み取ってください。',
  ];
  const context = input.context?.trim();
  if (context) lines.push(`利用者からの補足: ${context}`);
  return lines.join('\n');
}

export class GeminiRecipePageProvider implements RecipePageProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new RecipePageConfigError('GEMINI_API_KEY is not set');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async read(input: RecipePageInput): Promise<RecipePageRaw> {
    const systemText = withUnitSystem(
      withOutputLanguage(SYSTEM_PROMPT, input.outputLocale ?? DEFAULT_OUTPUT_LOCALE),
      input.unitSystem ?? DEFAULT_UNIT_SYSTEM,
    );
    const imageParts = input.images.map((image) => ({
      inlineData: { mimeType: image.mimeType, data: image.imageBase64 },
    }));

    const body = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [
        {
          role: 'user',
          parts: [...imageParts, { text: buildUserText(input) }],
        },
      ],
      generationConfig: {
        // 書き写すだけなので創作性は不要。identify-vision と同じ 0.1
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        ...thinkingConfigFragment(),
      },
    };

    const url = `${GEMINI_ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`;
    let lastError = '';

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(BACKOFF_MS[attempt] ?? 4_000);

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
        throw new RecipePageRequestError(lastError);
      }

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        lastError = 'empty model response';
        continue;
      }
      // ここでは検証しない。**素通しを防ぐのは agent の責務**（identify-vision と同じ作法）
      return JSON.parse(text) as RecipePageRaw;
    }

    throw new RecipePageRequestError(lastError || 'Gemini request failed');
  }
}
