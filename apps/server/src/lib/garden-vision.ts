import { DEFAULT_OUTPUT_LOCALE, withOutputLanguage, type OutputLocale } from './output-locale.js';
import { thinkingConfigFragment } from './thinking-budget.js';

/**
 * Garden consult Vision — さいえん手帳（家庭菜園アプリ）の AI 相談。
 * 栽培の写真（+ 作物名 + 症状の説明）から、品種の推定・病害虫/生理障害の
 * 原因候補・一般的な対処を返す（さいえん手帳 R14/R15）。
 *
 * ## なぜこのサーバーに同居しているか
 *
 * さいえん手帳は自前のサーバーを持たない方針（固定費を増やさない）で、
 * 推論だけこの Railway インスタンスに相乗りしている（さいえん手帳 WBS 決定⑨）。
 * **レシピ系のプロンプト・スキーマとは共存させない** — このファイルと
 * routes/garden.ts に閉じ、既存の infer 系には触れないこと。
 *
 * ## 農薬ガード（さいえん手帳 要件定義 §8.4）
 *
 * 農薬取締法上、適用作物・希釈倍率を誤った使用推奨はリスクがある。
 * 出力は「病名・原因の候補 + 一般的な対策情報」に留め、特定農薬の使用指導
 * （製品名の推奨・希釈倍率・散布量/回数）はプロンプトで禁止している。
 * プロンプトを変えるときもこのガードは残すこと。
 */

export interface GardenConsultInput {
  imageBase64: string;
  mimeType: string;
  /** 栽培に登録されている作物名（例: ミニトマト）。品種推定の手がかり */
  cropName?: string;
  /** 利用者の相談・症状の説明（例: 下葉が黄色い）。無ければ写真だけの診断 */
  question?: string;
  /** 出力言語。省略時は ja。さいえん手帳 v1.0 は日本語のみだが、器は合わせておく */
  outputLocale?: OutputLocale;
}

/** Gemini の構造化出力そのまま（フィールドは自己申告なのですべて任意寄り） */
export interface GardenConsultRaw {
  /** 植物が写っているか。false なら他フィールドは意味を持たない */
  isPlant: boolean;
  /** 作物・品種の推定名（例: ミニトマト（アイコ系）） */
  plantGuess?: string;
  /** 推定の確度 */
  plantConfidence?: 'high' | 'medium' | 'low';
  /** 写真から見た株の状態 */
  healthStatus?: 'healthy' | 'concern' | 'unknown';
  /** 病害虫・生理障害の原因候補（可能性の高い順・最大 3 件） */
  issues?: {
    name: string;
    likelihood?: 'high' | 'medium' | 'low';
    /** 根拠となる見た目の特徴 */
    signs?: string;
  }[];
  /** 一般的な対処（農薬の使用指導なし） */
  advice?: string[];
  /** 診断精度を上げるために確認するとよい点 */
  checkPoints?: string[];
}

export interface GardenConsultProvider {
  consult(input: GardenConsultInput): Promise<GardenConsultRaw>;
}

export class GardenVisionConfigError extends Error {}
export class GardenVisionRequestError extends Error {}

const SYSTEM_PROMPT = [
  'あなたは家庭菜園（野菜づくり）の日本語アドバイザーです。',
  '栽培中の植物の写真と、あれば作物名・利用者の相談文をもとに、次を返します。',
  '1) 作物・品種の推定（plantGuess）。写真だけで断定できないため確度を自己申告します。',
  '2) 株の状態（healthStatus）と、病害虫・生理障害・環境要因の原因候補（issues）。',
  '   可能性の高い順に最大 3 件。断定せず、根拠となる見た目の特徴（signs）を添えます。',
  '3) 家庭菜園でできる一般的な対処（advice）。摘葉・水やりや置き場所の見直し・',
  '   防虫ネットなどの物理的防除・連作回避などの耕種的防除を優先します。',
  '4) 診断の精度を上げるために確認するとよい点（checkPoints）。',
  '',
  '重要な制約（必ず守ること）:',
  '- 特定の農薬・薬剤の製品名を挙げての使用推奨、希釈倍率・散布量・散布回数の指導はしません。',
  '  薬剤による防除に触れる場合は「農薬を使う場合は、対象作物に適用のある製品を選び、',
  '  製品ラベルの記載と関係法令に従ってください」という一般的な案内に留めます。',
  '- 収穫物が食べられるかどうか（可食判断）はしません。判断が必要な場合は',
  '  「不安がある場合は食べるのを避け、購入店や専門機関に相談してください」と案内します。',
  '- 医療・健康被害に関する助言はしません。',
  '- 植物・栽培に関係する写真でない場合は isPlant=false を返し、他の項目は空にします。',
  'すべて自然な日本語で、家庭菜園の初心者にも分かる言葉で書きます。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isPlant: { type: 'BOOLEAN' },
    plantGuess: { type: 'STRING' },
    plantConfidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    healthStatus: { type: 'STRING', enum: ['healthy', 'concern', 'unknown'] },
    issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          likelihood: { type: 'STRING', enum: ['high', 'medium', 'low'] },
          signs: { type: 'STRING' },
        },
        required: ['name'],
      },
    },
    advice: { type: 'ARRAY', items: { type: 'STRING' } },
    checkPoints: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['isPlant'],
} as const;

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 写真と一緒に渡す依頼文。相談文があればそれを主役にする */
function buildUserText(input: GardenConsultInput): string {
  const lines: string[] = [];
  if (input.cropName) lines.push(`育てている作物: ${input.cropName}`);
  if (input.question) {
    lines.push(`相談内容: ${input.question}`);
    lines.push('写真と相談内容をもとに、原因の候補と対処を教えてください。');
  } else {
    lines.push('この写真の植物の品種の推定と、株の状態の診断をしてください。');
  }
  return lines.join('\n');
}

export class GeminiGardenConsultProvider implements GardenConsultProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new GardenVisionConfigError('GEMINI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async consult(input: GardenConsultInput): Promise<GardenConsultRaw> {
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
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        // 思考トークンは課金上「出力」に計上され、レシピ側の実測では
        // 1 推論 ¥0.85 → ¥0.35 の差になっていた（thinking-budget.ts）。
        // ここも既定オフに倒す。品質が落ちるようなら Railway の
        // GEMINI_THINKING_BUDGET=auto で**デプロイ無しに**戻せる。
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
        throw new GardenVisionRequestError(lastError);
      }

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        lastError = 'empty model response';
        continue;
      }
      return JSON.parse(text) as GardenConsultRaw;
    }

    throw new GardenVisionRequestError(lastError || 'Gemini request failed');
  }
}

/** テスト用にプロンプトを検査できるよう公開（本番コードからは参照しない） */
export const GARDEN_SYSTEM_PROMPT_FOR_TESTING = SYSTEM_PROMPT;
