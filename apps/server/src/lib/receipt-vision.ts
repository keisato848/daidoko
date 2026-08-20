import { DEFAULT_OUTPUT_LOCALE, withOutputLanguage, type OutputLocale } from './output-locale.js';
import { thinkingConfigFragment } from './thinking-budget.js';
/**
 * Receipt Vision — extract grocery item names from a receipt photo so the
 * pantry can be stocked in one tap. Provider abstraction (default Gemini
 * Flash). Replaces / complements the on-device ML Kit OCR path, which is
 * Android-only and unavailable since the SDK 54 migration
 * (docs/買い物リスト・在庫設計.md §5.6, Issue #68).
 */
export interface ReceiptVisionInput {
  /** 出力言語。省略時は ja（既存の呼び出しは挙動が変わらない）。 */
  outputLocale?: OutputLocale;
  imageBase64: string;
  mimeType: string;
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

export const RECEIPT_SYSTEM_PROMPT = [
  'あなたはスーパーやコンビニのレシート写真から「食材・食品の品目」を抽出する日本語の専門家です。',
  'レシートに印字された商品行のうち、食材・食品・飲料だけを items に列挙してください。',
  '品目名は家庭の在庫管理に使える一般的な名前へ正規化します（例: 半角カナ「ｷﾞｭｳﾆｭｳ」→「牛乳」、「TVﾊﾟｽﾀ 1.6mm 500g」→「パスタ」）。ブランド名・容量・規格は省きます。',
  '日用品・雑貨（洗剤・ラップ等）、レジ袋、値引き・割引行、小計・合計・ポイント・釣銭などの非商品行は除外します。',
  '同じ品目が複数行あっても 1 つにまとめます（数量がすべて読み取れる場合のみ合算し、1 行でも読めなければ quantity を省きます）。',
  'quantity には購入数量を入れます。行に数量が印字されておらず内容量（例: 「豚こま 500g」）だけが読めるときは、その内容量を quantity、単位を unit にします。',
  'unit には印字された単位・助数詞（個・本・袋・パック・g・ml など）だけを入れます。数量しか印字されていない場合は unit を省きます。',
  '**数量が読み取れない・自信が無い場合は quantity を省きます（1 で埋めない）**。値引き行や単価行の数字を数量として拾わないでください。',
  '写真がレシートでない場合は isReceipt=false を返し、items は空にします。',
  'store には店名が読み取れた場合のみ設定します（任意）。',
  '読み取りの確からしさを confidence（high / medium / low）で自己申告します。',
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
    const body = {
      systemInstruction: {
        parts: [
          {
            text: withOutputLanguage(
              RECEIPT_SYSTEM_PROMPT,
              input.outputLocale ?? DEFAULT_OUTPUT_LOCALE,
            ),
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
            { text: 'このレシートから食材・食品の品目を抽出してください。' },
          ],
        },
      ],
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
