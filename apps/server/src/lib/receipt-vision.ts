import { DEFAULT_OUTPUT_LOCALE, withOutputLanguage, type OutputLocale } from './output-locale.js';
import { thinkingConfigFragment } from './thinking-budget.js';
import { isCategoryItemName } from './fridge-vision.js';
/**
 * Receipt — extract grocery items (name / quantity / unit) so the pantry can be
 * stocked in one tap. Provider abstraction (default Gemini Flash).
 *
 * **Two inputs, one structured output.** The device sends *text* when its
 * on-device OCR could read the receipt, and the *photo* only when it could not.
 * A receipt is a purchase history, so not sending the image is worth something
 * on its own, and the text call drops the image tokens
 * (docs/在庫・レシート設計レビュー.md §3.4 / Issue #178).
 * Both inputs share this schema and its post-processing — only the framing of
 * the prompt differs.
 */
export interface ReceiptVisionImageInput {
  /** 出力言語。省略時は ja（既存の呼び出しは挙動が変わらない）。 */
  outputLocale?: OutputLocale;
  imageBase64: string;
  mimeType: string;
}

/** 端末内 OCR が読み取った生テキスト（行の崩れ・列のずれ・誤認識を含む）。 */
export interface ReceiptVisionTextInput {
  outputLocale?: OutputLocale;
  ocrText: string;
}

export type ReceiptVisionInput = ReceiptVisionImageInput | ReceiptVisionTextInput;

export function isReceiptTextInput(input: ReceiptVisionInput): input is ReceiptVisionTextInput {
  return 'ocrText' in input;
}

/**
 * レシートの1品目。数量・単位は**読み取れたときだけ**入る（`docs/買い物リスト・在庫設計.md` §6）。
 * 読めなかったものを 1 で埋めない — 在庫の数量は合算されるので、推測した数字は
 * 「家に無いものが在庫にある」状態を静かに作る。
 */
export interface ReceiptVisionItemRaw {
  name?: string;
  quantity?: number;
  unit?: string;
}

export interface ReceiptVisionRaw {
  isReceipt: boolean;
  store?: string;
  items?: ReceiptVisionItemRaw[];
  confidence?: 'high' | 'medium' | 'low';
}

export interface ReceiptVisionProvider {
  infer(input: ReceiptVisionInput): Promise<ReceiptVisionRaw>;
}

export class ReceiptVisionConfigError extends Error {}
export class ReceiptVisionRequestError extends Error {}

/**
 * 品目の作り方。**画像経路とテキスト経路で共有する** — 片方だけ緩めると、同じレシートが
 * 経路によって違う在庫になる。数量は在庫で合算されるので、その差は消えずに積もる。
 */
const RECEIPT_ITEM_RULES = [
  '品目名は家庭の在庫管理に使える一般的な名前へ正規化します（例: 半角カナ「ｷﾞｭｳﾆｭｳ」→「牛乳」、「TVﾊﾟｽﾀ 1.6mm 500g」→「パスタ」）。ブランド名・容量・規格は省きます。',
  '日用品・雑貨（洗剤・ラップ等）、レジ袋、値引き・割引行、小計・合計・ポイント・釣銭などの非商品行は除外します。',
  '同じ品目が複数行あっても 1 つにまとめます（数量がすべて読み取れる場合のみ合算し、1 行でも読めなければ quantity を省きます）。',
  'quantity には購入数量を入れます。行に数量が印字されておらず内容量（例: 「豚こま 500g」）だけが読めるときは、その内容量を quantity、単位を unit にします。',
  'unit には印字された単位・助数詞（個・本・袋・パック・g・ml など）だけを入れます。数量しか印字されていない場合は unit を省きます。',
  '**数量が読み取れない・自信が無い場合は quantity を省きます（1 で埋めない）**。値引き行や単価行の数字を数量として拾わないでください。',
  // カテゴリ語・売り場名の禁止（冷蔵庫写真設計 §9 と同根の水平展開・2026-09-05）
  '「調味料」「飲料」「食品」のようなカテゴリ名や、「農産」「水産」「畜産」「日配」のような売り場・部門名の行は品目として拾いません。必ず具体的な品名だけを挙げます。',
];

const RECEIPT_TAIL_RULES = [
  'store には店名が読み取れた場合のみ設定します（任意）。',
  '読み取りの確からしさを confidence（high / medium / low）で自己申告します。',
];

export const RECEIPT_SYSTEM_PROMPT = [
  'あなたはスーパーやコンビニのレシート写真から「食材・食品の品目」を抽出する日本語の専門家です。',
  'レシートに印字された商品行のうち、食材・食品・飲料だけを items に列挙してください。',
  ...RECEIPT_ITEM_RULES,
  '写真がレシートでない場合は isReceipt=false を返し、items は空にします。',
  ...RECEIPT_TAIL_RULES,
].join('\n');

/**
 * テキスト経路のプロンプト。渡されるのは**端末内 OCR の生テキスト**なので、画像を見る前提の
 * 文言（「写真」「印字されている」）はそのままでは成り立たない。OCR は列がずれ、品名と数量が
 * 別の行に落ちる。そこを補うのがこちらの仕事になる。
 */
export const RECEIPT_TEXT_SYSTEM_PROMPT = [
  'あなたはレシートを OCR にかけて得られたテキストから「食材・食品の品目」を抽出する日本語の専門家です。',
  '入力は OCR の生テキストです。行の折り返し・列のずれ・誤認識が含まれます。品名と数量・単価が別の行に分かれていることがあるので、レシートの体裁として自然になるように対応づけてください。',
  'テキストに含まれる商品行のうち、食材・食品・飲料だけを items に列挙してください。',
  ...RECEIPT_ITEM_RULES,
  '意味の取れない文字列は OCR の誤認識です。品目として無理に採用しないでください。',
  'テキストがレシートのものでない場合は isReceipt=false を返し、items は空にします。',
  ...RECEIPT_TAIL_RULES,
].join('\n');

export const RECEIPT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isReceipt: { type: 'BOOLEAN' },
    store: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          // 数量・単位は任意（required に入れない）。読めなかったことを表せる必要がある。
          quantity: { type: 'NUMBER' },
          unit: { type: 'STRING' },
        },
        required: ['name'],
      },
    },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
  },
  required: ['isReceipt'],
} as const;

/**
 * レシートに印字されがちな売り場・部門名（カテゴリ語リストのレシート特有分）。
 * モバイル `receipt-vision.provider.ts` の写しと同じ語であること。
 */
export const RECEIPT_SECTION_WORDS = [
  '農産',
  '水産',
  '畜産',
  '青果',
  '精肉',
  '鮮魚',
  '日配',
  'デイリー',
  '雑貨',
] as const;

const SECTION_KEYS = new Set(RECEIPT_SECTION_WORDS.map((word) => word.normalize('NFKC')));

/**
 * ルートが返す前の検証（それまで生出力を素通ししていた — 水平展開規約②）。
 * レシートの品目には confidence が無いので、カテゴリ語・売り場名に**単体一致**した
 * 品目は除外する（fridge のように「要確認へ落とす」形が取れない）。
 * 「調味料入れ」のような複合語は対象外。
 */
export function sanitizeReceiptRaw(raw: ReceiptVisionRaw): ReceiptVisionRaw {
  const items = Array.isArray(raw.items)
    ? raw.items.filter((item) => {
        if (typeof item?.name !== 'string' || !item.name.trim()) return false;
        const name = item.name.trim();
        if (isCategoryItemName(name)) return false;
        if (SECTION_KEYS.has(name.normalize('NFKC').replace(/\s+/g, ''))) return false;
        return true;
      })
    : raw.items;
  return { ...raw, ...(items !== undefined && { items }) };
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiReceiptVisionProvider implements ReceiptVisionProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new ReceiptVisionConfigError('GEMINI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async infer(input: ReceiptVisionInput): Promise<ReceiptVisionRaw> {
    const isText = isReceiptTextInput(input);
    const parts = isText
      ? [
          { text: 'このレシートの OCR テキストから食材・食品の品目を抽出してください。' },
          { text: input.ocrText },
        ]
      : [
          { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
          { text: 'このレシートから食材・食品の品目を抽出してください。' },
        ];
    const body = {
      systemInstruction: {
        parts: [
          {
            text: withOutputLanguage(
              isText ? RECEIPT_TEXT_SYSTEM_PROMPT : RECEIPT_SYSTEM_PROMPT,
              input.outputLocale ?? DEFAULT_OUTPUT_LOCALE,
            ),
          },
        ],
      },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: RECEIPT_RESPONSE_SCHEMA,
        // レシートの読み取りは構造化抽出で、深い推論を要さない（`thinking-budget.ts`）。
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
        throw new ReceiptVisionRequestError(lastError);
      }

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        lastError = 'empty model response';
        continue;
      }
      return JSON.parse(text) as ReceiptVisionRaw;
    }

    throw new ReceiptVisionRequestError(lastError || 'Gemini request failed');
  }
}
