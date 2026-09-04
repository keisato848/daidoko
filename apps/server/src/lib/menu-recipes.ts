/**
 * 献立の不足分レシピを AI で一括生成する（M3・docs/買い物リスト・在庫設計.md §10.12）。
 *
 * 献立を組んだが手持ちレシピが足りず日数に届かないとき、不足の n 品ぶんの
 * レシピ下書きをまとめて作る。**1 回の LLM 呼び出しで n 品全部返させる** —
 * M3-3「一括生成 = 無料枠 1 回分」の原価根拠がこれ（品数分呼んだら根拠が崩れる）。
 *
 * `lib/recipe-consult.ts` の写し（provider 形・SYSTEM_PROMPT の書き方・
 * エラークラス・fetch/retry）。下書きの形は consult の `ConsultDraft` と揃えてあり、
 * 契約の正は `packages/shared/src/types/menu-recipes.ts`。**片方だけ直さないこと。**
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

/** 一括で生成できる品数の上限（shared の MAX_MENU_RECIPES_DAYS の写し）。 */
export const MAX_MENU_RECIPES_DAYS = 7;
/** 重複回避のために受けるタイトル数の上限（shared の写し）。 */
export const MAX_MENU_RECIPES_TITLES = 30;
/** 受ける在庫名の上限（shared の写し）。 */
export const MAX_MENU_RECIPES_PANTRY = 50;
/** 嗜好メモの上限（shared の写し）。 */
export const MAX_MENU_RECIPES_PREFERENCES = 400;

export interface MenuRecipesInput {
  /** 不足日数 = 生成する品数（1〜7） */
  days: number;
  /** 手持ちレシピのタイトル（重複回避用） */
  existingTitles: string[];
  /** 在庫の品名だけ（数量は渡さない） */
  pantry: string[];
  /** 家族の嗜好メモ（S21・任意） */
  preferences?: string;
  outputLocale?: OutputLocale;
  unitSystem?: OutputUnitSystem;
}

/** 生成レシピの下書き 1 品（shared `MenuRecipeDraft` の写し）。 */
export interface MenuRecipeDraft {
  title: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients: { name: string; amount?: string }[];
  steps: { body: string }[];
  tags?: string[];
}

/** モデルの生出力（未検証）。`sanitizeMenuRecipeDrafts()` が検証・正規化する。 */
export interface MenuRecipesRaw {
  recipes?: {
    title?: string;
    description?: string;
    servings?: number;
    cookTimeMin?: number;
    ingredients?: { name?: string; amount?: string }[];
    steps?: { body?: string }[];
    tags?: string[];
  }[];
}

export interface MenuRecipesProvider {
  generate(input: MenuRecipesInput): Promise<MenuRecipesRaw>;
}

export class MenuRecipesConfigError extends Error {}
export class MenuRecipesRequestError extends Error {}
/** 上流（Gemini）の利用枠切れ。再試行しても当面回復しない（recipe-consult.ts と同じ扱い）。 */
export class MenuRecipesQuotaError extends MenuRecipesRequestError {}

const SYSTEM_PROMPT = [
  'あなたは、家庭の平日の夕食を考える日本語の料理人です。',
  '利用者の献立に足りない品数ぶんのレシピを、指定の品数だけまとめて作ります。',
  '',
  '## 前提',
  '- 作るのは**平日の家庭料理**。特別な道具・技法・長時間の仕込みを要求しない。',
  '- 材料は**日本の一般的なスーパーで揃うもの**だけを使う。取り寄せ・専門店の材料を出さない。',
  '- 渡された「手持ちのレシピ」と**同じ料理・よく似た料理は作らない**。',
  '  タイトルが違っても中身が同じ（例: 肉じゃがとじゃがいもと牛肉の煮物）は重複とみなす。',
  '- 渡された在庫の品を**活かす**。ただし在庫だけで無理に作らない。',
  '  足りない材料は足りないものとして材料に書く。隠さない。',
  '- 生成する品同士も系統を散らす（主菜の食材・和洋中が偏らないようにする）。',
  '',
  '## 家族の好みが渡されたとき',
  '- 避けたいと書かれた食材・系統は使わない。好みと書かれたものへ寄せてよい。',
  '- 渡されていないときは、好みの話をしない。勝手に想定しない。',
  '',
  '## 各レシピの書き方',
  '- title は料理名だけ（「〜のレシピ」と書かない）。',
  '- description は 1〜2 文。どんな料理か・どんな日に向くかだけ。',
  '- 分量は具体値で書く（「少々」で済ませない。ただし塩・こしょうは「少々」でよい）。',
  '- 手順は家庭の台所でそのまま実行できる粒度で、1 手順 1 文を目安にする。',
  '- servings は 2 を基本にする。cookTimeMin は現実的な調理時間（分）。',
  '',
  '## してはならないこと',
  '- 指定より多い・少ない品数を返す。',
  '- **アレルゲンの有無を保証する。**「ナッツ不使用です」のような断定はしない。',
  '- 栄養素・カロリーの数値を出す（このアプリの扱う範囲ではない）。',
  '- 在庫に無い品名を「ある」と書く。値段・節約に触れる。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    recipes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          description: { type: 'STRING' },
          servings: { type: 'INTEGER' },
          cookTimeMin: { type: 'INTEGER' },
          ingredients: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                amount: { type: 'STRING' },
              },
              required: ['name'],
              propertyOrdering: ['name', 'amount'],
            },
          },
          steps: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { body: { type: 'STRING' } },
              required: ['body'],
              propertyOrdering: ['body'],
            },
          },
          tags: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['title', 'ingredients', 'steps'],
        propertyOrdering: [
          'title',
          'description',
          'servings',
          'cookTimeMin',
          'ingredients',
          'steps',
          'tags',
        ],
      },
    },
  },
  required: ['recipes'],
  propertyOrdering: ['recipes'],
};

/** 構造化出力のスキーマ（テストから必須項目を固定するために公開する）。 */
export function buildMenuRecipesResponseSchema(): typeof GEMINI_RESPONSE_SCHEMA {
  return GEMINI_RESPONSE_SCHEMA;
}

/**
 * 品数・手持ち・在庫・好みを、モデルに渡す 1 つの user メッセージにまとめる
 * （`menu-arrange.ts` の `buildMenuContext` と同じ流儀）。
 */
export function buildMenuRecipesContext(input: MenuRecipesInput): string {
  const preferences = input.preferences?.trim();
  return [
    '## 作る品数',
    String(input.days),
    '## 手持ちのレシピ（これと被らないこと）',
    input.existingTitles.slice(0, MAX_MENU_RECIPES_TITLES).join('、') || '（まだ無い）',
    '## 在庫にある品名',
    input.pantry.slice(0, MAX_MENU_RECIPES_PANTRY).join('、') || '（在庫は空）',
    '## 家族の好み・避けたいもの',
    preferences || '（指定なし）',
  ].join('\n');
}

/**
 * 構造化出力でも `"null"` / `"undefined"` という**文字列**が返ることがある（実測・
 * recipe-consult.agent.ts と同じ防御）。そのまま入れると材料名が「null」になる。
 */
function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return undefined;
  return trimmed.slice(0, max);
}

function cleanPositiveInt(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > max) return undefined;
  return rounded;
}

/** タイトル重複判定用の正規化（空白と全角/半角の差だけ吸収する軽いもの）。 */
function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, '').toLowerCase();
}

/**
 * モデル生出力を検証・正規化する（正典）。**モバイルは写しを持つ**
 * （BYOK 経路はサーバーを通らないので必須。managed 応答にも防御的に通す —
 * `menu-arrange.ts` の `sanitizeMenuDays` と同じ役割分担）。片方だけ直さないこと。
 *
 * 規則（順に適用。捨てる方向のみ・埋めない）:
 * 1. title が無い・材料が空・手順が空の品 → 捨てる（半端な下書きは保存できない）
 * 2. 手持ちレシピとタイトルが同じ（正規化一致）品 → 捨てる（重複回避の決定的防御）
 * 3. 生成結果同士でタイトルが同じ品 → 2 品目以降を捨てる
 * 4. days を超えたぶん → 捨てる（多く返っても先頭から days 品だけ）
 * 5. 各フィールドは consult と同じ上限で整形（title 100・材料名 50・分量 30・手順 500 等）
 */
export function sanitizeMenuRecipeDrafts(
  raw: MenuRecipesRaw['recipes'] | null | undefined,
  existingTitles: readonly string[],
  days: number,
): MenuRecipeDraft[] {
  const taken = new Set(existingTitles.map(normalizeTitle));
  const drafts: MenuRecipeDraft[] = [];

  for (const item of raw ?? []) {
    if (drafts.length >= days) break; // 4

    const title = cleanString(item?.title, 100);
    if (!title) continue; // 1

    const ingredients = (item?.ingredients ?? [])
      .map((ing) => {
        const name = cleanString(ing?.name, 50);
        if (!name) return null;
        const amount = cleanString(ing?.amount, 30);
        return { name, ...(amount !== undefined && { amount }) };
      })
      .filter((ing): ing is NonNullable<typeof ing> => ing !== null);
    const steps = (item?.steps ?? [])
      .map((step) => cleanString(step?.body, 500))
      .filter((body): body is string => body !== undefined)
      .map((body) => ({ body }));
    if (ingredients.length === 0 || steps.length === 0) continue; // 1

    const key = normalizeTitle(title);
    if (taken.has(key)) continue; // 2, 3
    taken.add(key);

    const description = cleanString(item?.description, 500);
    const servings = cleanPositiveInt(item?.servings, 99);
    const cookTimeMin = cleanPositiveInt(item?.cookTimeMin, 999);
    const tags = Array.isArray(item?.tags)
      ? item.tags
          .map((tag) => cleanString(tag, 30))
          .filter((tag): tag is string => tag !== undefined)
          .slice(0, 10)
      : undefined;

    drafts.push({
      title,
      ...(description !== undefined && { description }),
      ...(servings !== undefined && { servings }),
      ...(cookTimeMin !== undefined && { cookTimeMin }),
      ingredients,
      steps,
      ...(tags !== undefined && tags.length > 0 && { tags }),
    });
  }

  return drafts;
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// n 品まとめて書かせるぶん出力が長い。consult（30s）より長めに待つ
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Google Gemini (Flash) implementation via the REST generateContent API. */
export class GeminiMenuRecipesProvider implements MenuRecipesProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new MenuRecipesConfigError('GEMINI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async generate(input: MenuRecipesInput): Promise<MenuRecipesRaw> {
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
      contents: [{ role: 'user', parts: [{ text: buildMenuRecipesContext(input) }] }],
      generationConfig: {
        // 相談（0.6）と同じ。生成は提案の幅がある方が役に立つ
        temperature: 0.6,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        // 一括 1 操作 1 回とはいえ課金される。ここが一番効く（`thinking-budget.ts`）
        ...thinkingConfigFragment(),
      },
    };

    let lastError: Error = new MenuRecipesRequestError('menu recipes failed');
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
            throw new MenuRecipesQuotaError(`Gemini quota exceeded: ${detail}`);
          }
          if (RETRYABLE_STATUS.has(res.status)) {
            lastError = new MenuRecipesRequestError(`Gemini ${res.status}: ${detail}`);
            continue;
          }
          throw new MenuRecipesRequestError(`Gemini ${res.status}: ${detail}`);
        }
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new MenuRecipesRequestError('Gemini returned no content');
        return JSON.parse(text) as MenuRecipesRaw;
      } catch (err) {
        if (err instanceof MenuRecipesQuotaError) throw err;
        lastError = err instanceof Error ? err : new MenuRecipesRequestError(String(err));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}
