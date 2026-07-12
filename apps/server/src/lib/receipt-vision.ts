/**
 * Receipt Vision — extract grocery item names from a receipt photo so the
 * pantry can be stocked in one tap. Provider abstraction (default Gemini
 * Flash). Replaces / complements the on-device ML Kit OCR path, which is
 * Android-only and unavailable since the SDK 54 migration
 * (docs/買い物リスト・在庫設計.md §5.6, Issue #68).
 */
export interface ReceiptVisionInput {
  imageBase64: string;
  mimeType: string;
}

export interface ReceiptVisionRaw {
  isReceipt: boolean;
  store?: string;
  items?: { name?: string }[];
  confidence?: 'high' | 'medium' | 'low';
}

export interface ReceiptVisionProvider {
  infer(input: ReceiptVisionInput): Promise<ReceiptVisionRaw>;
}

export class ReceiptVisionConfigError extends Error {}
export class ReceiptVisionRequestError extends Error {}

const SYSTEM_PROMPT = [
  'あなたはスーパーやコンビニのレシート写真から「食材・食品の品目」を抽出する日本語の専門家です。',
  'レシートに印字された商品行のうち、食材・食品・飲料だけを items に列挙してください。',
  '品目名は家庭の在庫管理に使える一般的な名前へ正規化します（例: 半角カナ「ｷﾞｭｳﾆｭｳ」→「牛乳」、「TVﾊﾟｽﾀ 1.6mm 500g」→「パスタ」）。ブランド名・容量・規格は省きます。',
  '日用品・雑貨（洗剤・ラップ等）、レジ袋、値引き・割引行、小計・合計・ポイント・釣銭などの非商品行は除外します。',
  '同じ品目が複数行あっても 1 つにまとめます。',
  '写真がレシートでない場合は isReceipt=false を返し、items は空にします。',
  'store には店名が読み取れた場合のみ設定します（任意）。',
  '読み取りの確からしさを confidence（high / medium / low）で自己申告します。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isReceipt: { type: 'BOOLEAN' },
    store: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' } },
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
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
