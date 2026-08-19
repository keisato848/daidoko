/**
 * Harvest Vision — さいえん手帳の「収穫を写真で記録する」（saien-techo#143）。
 *
 * 採れた野菜の写真から**作物と個数**を推定して返す。診断（garden-vision）とは
 * 別物なので分けている:
 *
 * | | garden-vision（AI 相談） | harvest-vision（この file） |
 * | --- | --- | --- |
 * | 目的 | 病害虫・生育の診断 | **記録の下書きを作る** |
 * | 出力 | 原因候補・アドバイス・確認点（長い） | 作物名と個数（短い） |
 * | 実測の単価 | ¥0.35 | **¥0.07**（出力が 1/15） |
 * | 頻度 | 1 回/日 程度 | 収穫期はほぼ毎日 |
 *
 * ## 数えられないものは、数えない
 *
 * `defaultUnit` の分布を数えたところ、30 作物のうち写真で数えられるのは
 * `piece` の 20 作物だけだった（`bunch` 8 / `plant` 1 / `kg` 1 は数えられない）。
 * さらに `piece` の中にも**ミニトマトのように小さく多いものは重なって数えられない**。
 *
 * **嘘の数字を返すより、`count` を返さない方がよい。** 収穫記録の数量は
 * さいえん手帳側で元から任意（`HarvestItem.quantity` が nullable）なので、
 * 空のままでも記録は成立する。約束するのは「作物と日付は埋まる」まで。
 *
 * ## 思考トークンは切る
 *
 * 個数を数えるのに深い推論は要らない。`thinkingConfigFragment()` を通す
 * （既定オフ・`GEMINI_THINKING_BUDGET=auto` で戻せる）。
 */
import { DEFAULT_OUTPUT_LOCALE, withOutputLanguage, type OutputLocale } from './output-locale.js';
import { thinkingConfigFragment } from './thinking-budget.js';

export interface HarvestVisionInput {
  imageBase64: string;
  mimeType: string;
  /** 栽培に登録されている作物名。推定の手がかり（任意） */
  cropName?: string;
  outputLocale?: OutputLocale;
}

export interface HarvestVisionRaw {
  /** 収穫物（採れた野菜）が写っているか。false なら他は空 */
  isHarvest: boolean;
  cropGuess?: string;
  cropConfidence?: 'high' | 'medium' | 'low';
  /** **数えられたときだけ返る。** 重なって数えられない場合は返さない */
  count?: number;
  countConfidence?: 'high' | 'medium' | 'low';
  /** 数えられなかった理由など、確認画面に出す一言（任意） */
  note?: string;
}

export interface HarvestVisionProvider {
  analyze(input: HarvestVisionInput): Promise<HarvestVisionRaw>;
}

export class HarvestVisionConfigError extends Error {}
export class HarvestVisionRequestError extends Error {}

const SYSTEM_PROMPT = [
  'あなたは家庭菜園の収穫記録を手伝うアシスタントです。',
  '採れた野菜の写真から、次を返します。',
  '1) 収穫物が写っているか（isHarvest）。野菜・果実が写っていなければ false にして他は空にします。',
  '2) 作物の推定（cropGuess）と確度（cropConfidence）。作物名のヒントがあれば優先して考慮します。',
  '3) 個数（count）。**数えられるときだけ**返します。',
  '4) 数えられなかったときや、注意が要るときの一言（note）。',
  '',
  '個数について（最重要）:',
  '- **確実に数えられるときだけ count を返します。** 推測で数を出してはいけません。',
  '- 重なっている・山盛りになっている・見切れている・多すぎて数え切れない場合は',
  '  **count を返さず**、note に「重なっていて数えられませんでした」のように理由を書きます。',
  '- ミニトマトのように小さく数が多いものは、はっきり全部見えている場合を除き数えません。',
  '- ホウレンソウやコマツナのような「束」で数えるもの、ジャガイモのような重さで量るものは',
  '  個数の概念が合わないので count を返しません。',
  '- 数えた場合でも自信の度合いを countConfidence に正直に入れます。',
  '',
  'そのほか:',
  '- 可食判断（食べられるかどうか）はしません。',
  '- 品質や等級の評価はしません。記録の下書きを作るのが目的です。',
  'すべて自然な日本語で、短く書きます。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isHarvest: { type: 'BOOLEAN' },
    cropGuess: { type: 'STRING' },
    cropConfidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    count: { type: 'INTEGER' },
    countConfidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    note: { type: 'STRING' },
  },
  required: ['isHarvest'],
} as const;

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * 予算は呼び出し側（さいえん手帳アプリ）の待ち時間の中に収める。
 * 詳しい理由は `garden-vision.ts` の同名定数のコメントを参照。
 * 出力が短いぶん診断より速いはずだが、同じ 15 秒 × 3 にしておく。
 */
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000];

/** 最悪ケースの所要時間（ミリ秒）。テストが上限を見張るために公開する。 */
export const HARVEST_RETRY_BUDGET_MS =
  REQUEST_TIMEOUT_MS * MAX_ATTEMPTS +
  BACKOFF_MS.slice(0, MAX_ATTEMPTS).reduce((sum, ms) => sum + ms, 0);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUserText(input: HarvestVisionInput): string {
  const hint = input.cropName?.trim();
  return hint
    ? `この栽培には「${hint}」が登録されています。写真の収穫物を記録してください。`
    : '写真の収穫物を記録してください。';
}

export class GeminiHarvestVisionProvider implements HarvestVisionProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new HarvestVisionConfigError('GEMINI_API_KEY is not set');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async analyze(input: HarvestVisionInput): Promise<HarvestVisionRaw> {
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
            { text: buildUserText(input) },
          ],
        },
      ],
      generationConfig: {
        // 数を読み取るだけなので創作性は不要。診断（0.4）より低くする。
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
        throw new HarvestVisionRequestError(lastError);
      }

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        lastError = 'empty model response';
        continue;
      }
      // ここでは sanitize しない。**素通しを防ぐのはルートの責務**
      // （provider を差し替えても必ず通るように）。
      return JSON.parse(text) as HarvestVisionRaw;
    }

    throw new HarvestVisionRequestError(lastError || 'Gemini request failed');
  }
}

/**
 * モデルの返しをそのまま信じない。**数量は台帳に載る値**なので、
 * ありえない値が混ざったら黙って落とす（空のままでも記録は成立する）。
 *
 * **呼ぶのはルート。** provider の中でやると、provider を差し替えたときに
 * 素通りする（テストで実際に踏んだ）。境界で 1 回だけ通す。
 */
export function sanitize(raw: HarvestVisionRaw): HarvestVisionRaw {
  if (!raw.isHarvest) return { isHarvest: false };

  const out: HarvestVisionRaw = { isHarvest: true };
  if (raw.cropGuess?.trim()) out.cropGuess = raw.cropGuess.trim().slice(0, 50);
  if (raw.cropConfidence) out.cropConfidence = raw.cropConfidence;
  if (raw.note?.trim()) out.note = raw.note.trim().slice(0, 200);

  // 0 個の「収穫」は記録として意味がない。負数・小数・桁外れも落とす。
  // 上限 999 は、家庭菜園の 1 回の収穫としてこれを超えたら数え間違いとみなす方が安全。
  if (
    typeof raw.count === 'number' &&
    Number.isInteger(raw.count) &&
    raw.count > 0 &&
    raw.count <= 999
  ) {
    out.count = raw.count;
    if (raw.countConfidence) out.countConfidence = raw.countConfidence;
  }
  return out;
}

/** テスト用にプロンプトを検査できるよう公開（本番コードからは参照しない） */
export const HARVEST_SYSTEM_PROMPT_FOR_TESTING = SYSTEM_PROMPT;
