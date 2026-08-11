/**
 * Recipe consultation — 作りたいものを相談しながらレシピにする。
 *
 * 写真からレシピ（`vision-recipe.ts`）は**目の前に料理がある**ときの機能で、
 * こちらは**まだ料理が無い**ときの機能。「なんとなく作りたいもの」から会話で
 * 形にしていく。設計は `docs/相談してレシピを作る設計.md`。
 *
 * **献立を自動生成する機能ではない。** `docs/要件定義.md` §4 で
 * 「AIによる献立自動生成」は非対象としてある（過度な自動化はアナログ感を損なう）。
 * ここで守るのは、**決めるのは常に利用者**という一点。モデルは提案と質問をするが、
 * 勝手に決め切らないし、聞かれていないことを足さない。
 */
import {
  DEFAULT_OUTPUT_LOCALE,
  DEFAULT_UNIT_SYSTEM,
  withOutputLanguage,
  withUnitSystem,
  type OutputLocale,
  type OutputUnitSystem,
} from './output-locale.js';

export type ConsultRole = 'user' | 'assistant';

export interface ConsultMessage {
  role: ConsultRole;
  text: string;
}

export interface ConsultIngredient {
  groupLabel?: string;
  name: string;
  amount?: string;
  note?: string;
}

/** 会話の途中で育っていく下書き。保存前のもので、DB には入っていない。 */
export interface ConsultDraft {
  title: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients: ConsultIngredient[];
  steps: { body: string }[];
  tags?: string[];
}

export interface ConsultRecipeInput {
  /** 会話。最後がいちばん新しい発言。 */
  messages: ConsultMessage[];
  /** いま手元にある下書き。2 回目以降の往復で送る。 */
  draft?: ConsultDraft | null;
  /**
   * 手元の在庫（材料名）。**任意**。
   * 既定では送らない — 何を送ったか利用者に見えている状態を保つため。
   */
  pantry?: string[];
  outputLocale?: OutputLocale;
  unitSystem?: OutputUnitSystem;
}

/** Raw, unvalidated model output. The agent validates/normalizes it. */
export interface ConsultRecipeRaw {
  /** 相談相手としての返事。短く、質問は一度に 1 つだけ。 */
  reply?: string;
  /** 保存できる状態か（材料と手順が揃っているか）。 */
  ready?: boolean;
  /** 現時点の下書き。まだ出せないうちは省略される。 */
  draft?: {
    title?: string;
    titleReading?: string;
    description?: string;
    servings?: number;
    cookTimeMin?: number;
    ingredients?: ConsultIngredient[];
    steps?: { body?: string }[];
    tags?: string[];
  };
}

export interface RecipeConsultProvider {
  consult(input: ConsultRecipeInput): Promise<ConsultRecipeRaw>;
}

export class ConsultConfigError extends Error {}
export class ConsultRequestError extends Error {}
/** 上流（Gemini）の利用枠切れ。再試行しても当面回復しない（Issue #120 と同じ扱い）。 */
export class ConsultQuotaError extends ConsultRequestError {}

/** 1 リクエストで送る会話の上限。長くなるほど入力トークンが増えるため頭を落とす。 */
export const MAX_CONSULT_MESSAGES = 24;

const SYSTEM_PROMPT = [
  'あなたは、家庭料理を一緒に考える日本語の料理人です。',
  '利用者が「作りたいもの」を話すのを聞き、レシピの下書きに落としていきます。',
  '',
  '## 役割',
  '- あなたは**相談相手**であって、献立を決める人ではない。決めるのは常に利用者。',
  '- 返事は短く。3 文以内を目安にする。長い説明より、次の一手が分かることを優先する。',
  '- **質問は一度に 1 つだけ。** 人数・時間・食べられないもの・好みを一度に並べて聞かない。',
  '',
  '## 下書きを出すタイミング',
  '- 料理の見当がついたら、**聞き切る前に**下書きを出す。',
  '  たたき台があった方が「そうじゃない」と言いやすい。',
  '- まだ料理が絞れないとき（例: 「何か作りたい」だけ）は下書きを出さず、質問だけ返す。',
  '- 下書きを出したら reply では**変えた点だけ**に触れる。全文を読み上げない。',
  '',
  '## 下書きの直し方',
  '- **言われた点だけを変える。** 関係ない材料・手順は一字一句そのまま残す。',
  '  「ついでに良くする」ことをしてはならない。',
  '- 分量は具体値で書く（「少々」で済ませない。ただし塩・こしょうは「少々」でよい）。',
  '- 家庭の台所と、近所のスーパーで買えるもので作れる範囲に収める。',
  '- draft は常に**レシピ全体**を返す（差分ではない）。',
  '',
  '## 在庫が渡されたとき',
  '- 使えるものを優先して組み立てる。ただし**在庫だけで無理に作らない**。',
  '- 足りないものは足りないものとして材料に書く。隠さない。',
  '- 在庫が渡されていないときは、在庫の話をしない。',
  '',
  '## ready',
  '材料と手順が揃い、そのまま作れる状態になったら ready=true。',
  'まだ質問している段階では false。',
  '',
  '## してはならないこと',
  '- 利用者が言っていない制約（アレルギー・嫌いなもの）を勝手に決めつける。',
  '- **アレルゲンの有無を保証する。** 「ナッツ不使用です」のような断定はしない。',
  '  食べられないものを聞かれた範囲で避けるだけにとどめる。',
  '- 栄養素・カロリーの数値を出す（このアプリの扱う範囲ではない）。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    ready: { type: 'BOOLEAN' },
    draft: {
      type: 'OBJECT',
      properties: {
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
      propertyOrdering: [
        'title',
        'titleReading',
        'description',
        'servings',
        'cookTimeMin',
        'ingredients',
        'steps',
        'tags',
      ],
    },
  },
  // reply は必ず要る（無言だと会話が止まる）。draft は「まだ出せない」が正当な状態なので必須にしない。
  required: ['reply', 'ready'],
  propertyOrdering: ['reply', 'ready', 'draft'],
};

/** 構造化出力のスキーマ（テストから必須項目を固定するために公開する）。 */
export function buildConsultResponseSchema(): typeof GEMINI_RESPONSE_SCHEMA {
  return GEMINI_RESPONSE_SCHEMA;
}

/**
 * 会話が長くなったら**古い方から落とす**。直近のやり取りほど効くので、
 * 頭を削る方が finish reason で切られるより安全。
 */
export function trimMessages(
  messages: ConsultMessage[],
  max = MAX_CONSULT_MESSAGES,
): ConsultMessage[] {
  return messages.length <= max ? messages : messages.slice(messages.length - max);
}

/** 現在の下書きと在庫を、モデルに渡す 1 つの user メッセージにまとめる。 */
export function buildContextText(input: ConsultRecipeInput): string {
  const parts: string[] = [];
  if (input.draft) {
    parts.push('## いまの下書き', JSON.stringify(input.draft, null, 2));
  }
  const pantry = (input.pantry ?? []).filter((name) => name.trim()).slice(0, 200);
  if (pantry.length > 0) {
    parts.push(
      '## 手元にある材料（在庫）',
      pantry.join('、'),
      'これらを優先して使ってよい。ただし在庫だけで無理に作らないこと。',
    );
  }
  return parts.join('\n');
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
export class GeminiRecipeConsultProvider implements RecipeConsultProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new ConsultConfigError('GEMINI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async consult(input: ConsultRecipeInput): Promise<ConsultRecipeRaw> {
    const messages = trimMessages(input.messages);
    const context = buildContextText(input);

    // 会話はそのまま contents に流す。下書きと在庫は**最後の user 発言に添える**
    // （直近ほど効くため、古い turn に混ぜない）。
    const contents = messages.map((message, index) => {
      const isLast = index === messages.length - 1;
      const text = isLast && context ? `${message.text}\n\n${context}` : message.text;
      return { role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
    });

    const body = {
      systemInstruction: {
        parts: [
          {
            text: withUnitSystem(
              withOutputLanguage(SYSTEM_PROMPT, input.outputLocale ?? DEFAULT_OUTPUT_LOCALE),
              input.unitSystem ?? DEFAULT_UNIT_SYSTEM,
            ),
          },
        ],
      },
      contents,
      generationConfig: {
        // 写真レシピ（0.4）より少し高い。相談は提案の幅がある方が役に立つ
        temperature: 0.6,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    };

    let lastError: Error = new ConsultRequestError('consult failed');
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (BACKOFF_MS[attempt]) await sleep(BACKOFF_MS[attempt] as number);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(
          `${GEMINI_ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 300);
          // 429 は「上限」と「一時的な混雑」の両方で返る。上限は再試行しても当面回復しない
          if (res.status === 429 && /quota|billing|exceeded/i.test(detail)) {
            throw new ConsultQuotaError(`Gemini quota exceeded: ${detail}`);
          }
          if (RETRYABLE_STATUS.has(res.status)) {
            lastError = new ConsultRequestError(`Gemini ${res.status}: ${detail}`);
            continue;
          }
          throw new ConsultRequestError(`Gemini ${res.status}: ${detail}`);
        }
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new ConsultRequestError('Gemini returned no content');
        return JSON.parse(text) as ConsultRecipeRaw;
      } catch (err) {
        if (err instanceof ConsultQuotaError) throw err;
        lastError = err instanceof Error ? err : new ConsultRequestError(String(err));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}
