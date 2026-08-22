/**
 * Identify Vision — さいえん手帳の「写真から栽培を登録する」（saien-techo#139 / #149）。
 *
 * 苗のラベル・種袋、または育っている株の写真から**作物名と品種**を推定して返す。
 * 相談（garden-vision）・収穫（harvest-vision）とは別物なので分けている:
 *
 * | | garden-vision（相談） | harvest-vision（収穫） | identify-vision（この file） |
 * | --- | --- | --- | --- |
 * | 目的 | 病害虫・生育の診断 | 収穫記録の下書き | **栽培登録の下書き** |
 * | 出力 | 原因候補・助言（長い） | 作物名と個数 | 作物名と品種（短い） |
 * | 頻度 | 毎日ありうる | 収穫期はほぼ毎日 | **年に数回 × 株数** |
 *
 * ## 既存の 2 本は流用できない（実測・2026-08-22）
 *
 * 本番の `/garden/consult` に模擬種袋を投げたところ `{"isPlant": false}` だけが返り、
 * **作物名も品種も一切返らなかった**。診断プロンプトが植物以外を意図的に弾くため。
 * `/garden/harvest` も「株から切り離してあるものだけが収穫物」と定義しており、
 * 育っている株を弾く（saien-techo#149 に記録済み）。
 * **登録は「まだ何も無い状態」から始まるので、弾かれては始まらない。**
 *
 * ## ラベルと株を 1 本で扱う
 *
 * 登録の入口はひとつ（「写真から登録」）で、ユーザーはラベルと株を混ぜて撮る。
 * どちらを撮ったかを**モデルに判定させて** `source` で返し、端末側は同じ確認画面に流す。
 * 分けて 2 エンドポイントにすると、撮る前にユーザーへモード選択を強いることになる。
 *
 * ## 品種が取れるのはラベルだけ
 *
 * 「アイコ」「桃太郎」は**印刷された固有名詞を読むタスク**で、株の外見からは決まらない
 * （#139）。株の写真で品種を創作されると台帳に嘘が載るので、
 * **`source==='plant'` のときは品種を返させない**。
 *
 * ## 思考トークンは切る
 *
 * ラベルを読む・作物を見分けるのに深い推論は要らない。harvest-vision と同じく
 * `thinkingConfigFragment()` を通す（既定オフ）。
 */
import { DEFAULT_OUTPUT_LOCALE, withOutputLanguage, type OutputLocale } from './output-locale.js';
import { thinkingConfigFragment } from './thinking-budget.js';

export interface IdentifyVisionInput {
  imageBase64: string;
  mimeType: string;
  /**
   * 端末が持っている作物マスターの名前（30 作物）。
   * 表記ゆれを減らすために「この中の名前を優先して使う」と伝える手がかり（任意）。
   */
  knownCrops?: string[];
  outputLocale?: OutputLocale;
}

/** 何を撮った写真だったか。品種を信じてよいかの判断に使う */
export type IdentifySource = 'label' | 'plant';

export interface IdentifyVisionRaw {
  /** 作物として登録できるものが写っているか。false なら他は空 */
  found: boolean;
  /** ラベル（種袋・苗札）か、育っている株か */
  source?: IdentifySource;
  cropGuess?: string;
  cropConfidence?: 'high' | 'medium' | 'low';
  /** **ラベルを読めたときだけ返る。** 株の外見からは決めない */
  variety?: string;
  /** 種からか苗からか。ラベルに書かれているときだけ */
  plantedAs?: 'seed' | 'seedling';
  /** 確認画面に出す一言（任意） */
  note?: string;
}

export interface IdentifyVisionProvider {
  analyze(input: IdentifyVisionInput): Promise<IdentifyVisionRaw>;
}

export class IdentifyVisionConfigError extends Error {}
export class IdentifyVisionRequestError extends Error {}

const SYSTEM_PROMPT = [
  'あなたは家庭菜園の栽培登録を手伝うアシスタントです。',
  '写真から、これから育てる（または既に育てている）作物を読み取って返します。',
  '',
  '最初に「何が写っているか」を判定します（source）:',
  '- label … 種袋・苗札・ラベル・タグなど、**文字が印刷されたもの**。',
  '- plant … 畑・プランター・鉢で**育っている株**（苗・葉・実）。',
  '  収穫済みで株から切り離された野菜も、育てているものの手がかりとして plant に含めます。',
  '- どちらでもない（風景・人・料理・道具だけなど）場合は found=false にして他は空にします。',
  '',
  'source=label のとき:',
  '- **印刷されている文字を正確に読みます。推測で補いません。**',
  '- cropGuess には作物名（「ミニトマト」「キュウリ」など）を入れます。',
  '- variety には品種名（「アイコ」「桃太郎」「うどんこつよし」など）を入れます。',
  '  品種名は商品名の一部として大きく書かれていることが多いです。',
  '  **書かれていない、または読めない場合は variety を返しません。**',
  '- 「種子」「タネ」とあれば plantedAs=seed、「苗」とあれば plantedAs=seedling を入れます。',
  '  判断できない場合は plantedAs を返しません。',
  '- 文字が読めた範囲で確度を cropConfidence に正直に入れます。',
  '',
  'source=plant のとき:',
  '- 見た目から作物を推定して cropGuess に入れます。',
  '- **variety は返しません。** 品種は株の外見からは決まらないので、',
  '  推測で入れると誤った記録になります。plantedAs も返しません。',
  '- 幼苗で見分けが付きにくい場合は cropConfidence を low にし、',
  '  note に「双葉のみで判別が難しいです」のように理由を書きます。',
  '',
  '作物名の書き方:',
  '- 一般的な和名のカタカナ表記にします（「ミニトマト」「エダマメ」「キュウリ」）。',
  '- 学名や英名は使いません。',
  '- 補足を括弧で足しません（「エダマメ（大豆）」ではなく「エダマメ」）。',
  '- 既知の作物名の一覧が渡された場合は、**その中の表記を優先して使います**。',
  '  一覧に無い作物が写っている場合は、無理に当てはめず一般的な和名で返します。',
  '',
  'そのほか:',
  '- 1 枚につき**主要な 1 つ**だけを返します。複数写っている場合はいちばん大きく写っているものにし、',
  '  note で「ほかにキュウリも写っています」のように触れるだけにします。',
  '- 栽培方法の助言はしません。登録の下書きを作るのが目的です。',
  'すべて自然な日本語で、短く書きます。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
    source: { type: 'STRING', enum: ['label', 'plant'] },
    cropGuess: { type: 'STRING' },
    cropConfidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    variety: { type: 'STRING' },
    plantedAs: { type: 'STRING', enum: ['seed', 'seedling'] },
    note: { type: 'STRING' },
  },
  required: ['found'],
} as const;

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * 予算は呼び出し側（さいえん手帳アプリ）の待ち時間の中に収める。
 * 詳しい理由は `garden-vision.ts` の同名定数のコメントを参照。
 * 出力は収穫と同じくらい短いので、同じ 15 秒 × 3 にしておく。
 */
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000];

/** 最悪ケースの所要時間（ミリ秒）。テストが上限を見張るために公開する。 */
export const IDENTIFY_RETRY_BUDGET_MS =
  REQUEST_TIMEOUT_MS * MAX_ATTEMPTS +
  BACKOFF_MS.slice(0, MAX_ATTEMPTS).reduce((sum, ms) => sum + ms, 0);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 端末の作物マスターを手がかりとして渡す。長すぎるとノイズになるので絞る。 */
const MAX_KNOWN_CROPS = 40;

function buildUserText(input: IdentifyVisionInput): string {
  const known = (input.knownCrops ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .slice(0, MAX_KNOWN_CROPS);
  if (known.length === 0) return 'この写真から登録する作物を読み取ってください。';
  return [
    'この写真から登録する作物を読み取ってください。',
    `アプリが扱う作物名の一覧: ${known.join('、')}`,
    'この中にあるものが写っている場合は、一覧の表記をそのまま使ってください。',
  ].join('\n');
}

export class GeminiIdentifyVisionProvider implements IdentifyVisionProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new IdentifyVisionConfigError('GEMINI_API_KEY is not set');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async analyze(input: IdentifyVisionInput): Promise<IdentifyVisionRaw> {
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
        // 印刷された文字を読む／見分けるだけなので創作性は不要。収穫と同じ 0.1。
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
        throw new IdentifyVisionRequestError(lastError);
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
      // （provider を差し替えても必ず通るように。harvest-vision と同じ作法）。
      return JSON.parse(text) as IdentifyVisionRaw;
    }

    throw new IdentifyVisionRequestError(lastError || 'Gemini request failed');
  }
}

/**
 * モデルの返しをそのまま信じない。**作物名と品種は台帳に載る値**なので、
 * ありえないものが混ざったら黙って落とす（空でも手入力で登録できる）。
 *
 * とくに **`source==='plant'` の品種は必ず落とす**。株の外見から品種は決まらないので、
 * 返ってきたら幻覚とみなす（プロンプトでも禁じているが、境界でも止める）。
 *
 * **呼ぶのはルート。** provider の中でやると差し替え時に素通りする。
 */
export function sanitize(raw: IdentifyVisionRaw): IdentifyVisionRaw {
  if (!raw.found) return { found: false };

  const out: IdentifyVisionRaw = { found: true };
  if (raw.source === 'label' || raw.source === 'plant') out.source = raw.source;
  if (raw.cropGuess?.trim()) out.cropGuess = raw.cropGuess.trim().slice(0, 50);
  if (raw.cropConfidence) out.cropConfidence = raw.cropConfidence;
  if (raw.note?.trim()) out.note = raw.note.trim().slice(0, 200);

  // 品種と植え方はラベルを読めたときだけ。株の写真からは決められない。
  if (out.source === 'label') {
    if (raw.variety?.trim()) out.variety = raw.variety.trim().slice(0, 50);
    if (raw.plantedAs === 'seed' || raw.plantedAs === 'seedling') out.plantedAs = raw.plantedAs;
  }

  // 作物名が無ければ登録の下書きにならない。found のまま空を返さない。
  if (!out.cropGuess) return { found: false, ...(out.note !== undefined && { note: out.note }) };
  return out;
}

/** テスト用にプロンプトを検査できるよう公開（本番コードからは参照しない） */
export const IDENTIFY_SYSTEM_PROMPT_FOR_TESTING = SYSTEM_PROMPT;
