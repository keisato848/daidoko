/**
 * 献立の並べ替え（AI）— docs/買い物リスト・在庫設計.md §10.10。
 *
 * 「作れるレシピ」（M1・機械採点）の並び順を、AI が飽きの来ない並びに組み替える。
 * **献立を自動生成する機能ではない。** 候補は M1 が渡したものだけ・新しいレシピは
 * 発明しない・決めるのは常に利用者。`lib/recipe-consult.ts` の写し
 * （provider 形・SYSTEM_PROMPT の書き方・エラークラス・fetch/retry）。
 *
 * `unitSystem` は受けない・渡さない（§10.5）— 分量を出力しない推論への単位系指示は、
 * 「分量を書け」という圧力になるだけ。
 */
import { DEFAULT_OUTPUT_LOCALE, withOutputLanguage, type OutputLocale } from './output-locale.js';
import { thinkingConfigFragment } from './thinking-budget.js';

export interface MenuCandidate {
  /** 端末ローカルの recipes.id。サーバーは解釈せず echo するだけ */
  id: string;
  title: string;
  cookTimeMin?: number;
  /** カバー率（%）。0〜100 の整数 */
  coveragePct: number;
  /** 不足材料の名前だけ（数量は契約上渡さない） */
  missing: string[];
}

export interface MenuArrangeInput {
  /** おすすめ順（M1 のスコア順）。カバー率順ではない */
  candidates: MenuCandidate[];
  /** 在庫にある品名だけ */
  pantry: string[];
  /** 直近に作った料理のタイトル */
  recentTitles?: string[];
  /** 並べる日数 */
  days: number;
  outputLocale?: OutputLocale;
}

export interface MenuDayPick {
  day: number;
  recipeId: string;
  why?: string;
}

export interface MenuArrangement {
  days: MenuDayPick[];
  note?: string;
}

/** モデルの生出力（未検証）。`sanitizeMenuDays()` が検証・正規化する。 */
export interface MenuArrangeRaw {
  days?: { day?: number; recipeId?: string; why?: string }[];
  note?: string;
}

export interface MenuArrangeProvider {
  arrange(input: MenuArrangeInput): Promise<MenuArrangeRaw>;
}

export class MenuArrangeConfigError extends Error {}
export class MenuArrangeRequestError extends Error {}
/** 上流（Gemini）の利用枠切れ。再試行しても当面回復しない（recipe-consult.ts と同じ扱い）。 */
export class MenuArrangeQuotaError extends MenuArrangeRequestError {}

export const MAX_MENU_CANDIDATES = 30;
export const MAX_MENU_DAYS = 7;

const SYSTEM_PROMPT = [
  'あなたは、家庭の献立の並びを整える料理人です。',
  '候補のレシピ一覧から指定の日数ぶんを選び直し、飽きの来ない並びにします。',
  '',
  '## 前提',
  '- 候補は「おすすめ順」に並んでいる。在庫との相性・最近作ったか・作りたい',
  '  リスト入りなどを機械的に採点した順であり、カバー率の順ではない。',
  '- 各候補の coveragePct は「いま家にある材料でどれだけ作れるか」（0〜100%）、',
  '  missing は足りない材料の名前、cookTimeMin は調理時間（分）。',
  '- あなたの仕事は候補の中からの選び直しと並べ替えだけ。新しいレシピを発明しない。',
  '- 決めるのは利用者。あなたの並びは提案であって、そのまま採用されるとは限らない。',
  '',
  '## 直すのは次の 3 点だけ',
  '1. 主菜の食材が続かないようにする。鶏の日が 2 日続く・魚の日が無い、のような',
  '   偏りを散らす。食材の系統はタイトルから推し量ってよい。',
  '2. 和・洋・中の系統が続かないようにする。これもタイトルから推し量ってよい。',
  '3. 調理時間の長い料理を連続させない。cookTimeMin の大きい日は散らす。',
  'このために coveragePct が多少低い候補を選んでよい。ただし coveragePct がほぼ 0 の',
  '候補を高い候補より優先しない（買い物が増えるだけの並びは改悪）。',
  '',
  '## 選び方',
  '- 各日 1 レシピ。候補一覧にある id だけを使う。',
  '- 同じレシピを 2 つの日に入れない。',
  '- 「直近に作った料理」と同じ・よく似た料理は前半の日に置かない。',
  '- 日数ぶんの候補が無いときは、あるぶんだけ返す。埋めるために無理をしない。',
  '- 散らしようが無いとき（候補が日数ちょうど・全部同系統）は、無いなりの並びで',
  '  よい。やってもいない工夫を理由に書かない。',
  '',
  '## why（各日の理由の一言）',
  '- その日にその料理を選んだ理由を 1 文・全角 40 字以内で書く。',
  '- 言及してよいのは渡された情報から言えることだけ: 料理名・調理時間・',
  '  「いまある材料で作れる」（coveragePct）・足りない材料の名前・在庫の品名・',
  '  直近に作った料理・並びの工夫（例:「前の日が肉なので魚に」）。',
  '- 同じ言い回しを全部の日に繰り返さない。',
  '- note は、献立全体に本当に伝えるべき補足があるときだけ 1 文',
  '  （例: 後半は買い足しが前提になる）。無ければ書かない。',
  '',
  '## してはならないこと',
  '- 分量・個数・グラム数を書く（渡されていない。書けば嘘になる）。',
  '- 賞味期限・鮮度・旬・季節・気温に触れる（渡されていない）。',
  '- 栄養・カロリー・健康効果・効能を書く（このアプリの扱う範囲ではない）。',
  '- 曜日・平日・週末に触れる（何曜日に作るかは渡されていない）。',
  '- 家族構成・好み・アレルギーを推測する。値段・節約に触れる。',
  '- 候補に無い id・レシピ名を作る。在庫に無い品名を「ある」と書く。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    days: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          day: { type: 'INTEGER' },
          recipeId: { type: 'STRING' },
          why: { type: 'STRING' },
        },
        required: ['day', 'recipeId', 'why'],
        propertyOrdering: ['day', 'recipeId', 'why'],
      },
    },
    note: { type: 'STRING' },
  },
  // days 空は構造として正当。note は「無いのが普通」なので必須にしない
  required: ['days'],
  propertyOrdering: ['days', 'note'],
};

/** 構造化出力のスキーマ（テストから必須項目を固定するために公開する）。 */
export function buildMenuResponseSchema(): typeof GEMINI_RESPONSE_SCHEMA {
  return GEMINI_RESPONSE_SCHEMA;
}

/**
 * 候補・在庫・直近の料理を、モデルに渡す 1 つの user メッセージにまとめる。
 * 候補は id 転記ミスを防ぐため JSON のまま送る（`name-resolve.ts` の先例）。
 */
export function buildMenuContext(input: MenuArrangeInput): string {
  return [
    '## 日数',
    String(input.days),
    '## 候補（おすすめ順）',
    JSON.stringify(input.candidates),
    '## 在庫にある品名',
    input.pantry.slice(0, 200).join('、') || '（在庫は空）',
    '## 直近に作った料理',
    (input.recentTitles ?? []).join('、') || '（記録なし）',
  ].join('\n');
}

/**
 * モデル生出力を検証・正規化する（正典）。評価ハーネス（`apps/server/scripts/`）は
 * 同一パッケージなので直接 import できる。**モバイルは写しを持つ**
 * （BYOK 経路はサーバーを通らないので必須。managed 応答にも防御的に通す）。
 * 写しを直すときは両方直すこと——片方だけ直さないこと。
 *
 * 規則（順に適用。捨てる方向のみ・埋めない）:
 * 1. recipeId が candidateIds に無い行 → 捨てる（ハルシネーション遮断）
 * 2. day が 1..dayCount の整数でない行 → 捨てる
 * 3. 同じ day の 2 件目以降 → 捨てる（先勝ち）
 * 4. 同じ recipeId の 2 日目以降 → 捨てる（M1 の「1 レシピ 1 日」不変条件）
 * 5. why は文字列整形（上限 100 字で切る）。無ければ undefined
 * 6. day 昇順に整列。dayCount 未満でも埋めない
 */
export function sanitizeMenuDays(
  raw: MenuArrangeRaw['days'] | null | undefined,
  candidateIds: ReadonlySet<string>,
  dayCount: number,
): MenuDayPick[] {
  const seenDays = new Set<number>();
  const seenRecipeIds = new Set<string>();
  const picks: MenuDayPick[] = [];

  for (const item of raw ?? []) {
    const recipeId = typeof item?.recipeId === 'string' ? item.recipeId : undefined;
    if (!recipeId || !candidateIds.has(recipeId)) continue; // 1

    const day = item?.day;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > dayCount) continue; // 2
    if (seenDays.has(day)) continue; // 3
    if (seenRecipeIds.has(recipeId)) continue; // 4

    seenDays.add(day);
    seenRecipeIds.add(recipeId);
    const why = cleanWhy(item?.why); // 5
    picks.push({ day, recipeId, ...(why !== undefined && { why }) });
  }

  picks.sort((a, b) => a.day - b.day); // 6
  return picks;
}

function cleanWhy(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 100) : undefined;
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
export class GeminiMenuArrangeProvider implements MenuArrangeProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new MenuArrangeConfigError('GEMINI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async arrange(input: MenuArrangeInput): Promise<MenuArrangeRaw> {
    const body = {
      systemInstruction: {
        parts: [
          {
            text: withOutputLanguage(SYSTEM_PROMPT, input.outputLocale ?? DEFAULT_OUTPUT_LOCALE),
          },
        ],
      },
      contents: [{ role: 'user', parts: [{ text: buildMenuContext(input) }] }],
      generationConfig: {
        // 相談（0.6）より低い。並べ替えは提案の幅より安定性を優先する
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        // 組む 1 操作 1 回とはいえ課金される。ここが一番効く（`thinking-budget.ts`）
        ...thinkingConfigFragment(),
      },
    };

    let lastError: Error = new MenuArrangeRequestError('menu arrange failed');
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
            throw new MenuArrangeQuotaError(`Gemini quota exceeded: ${detail}`);
          }
          if (RETRYABLE_STATUS.has(res.status)) {
            lastError = new MenuArrangeRequestError(`Gemini ${res.status}: ${detail}`);
            continue;
          }
          throw new MenuArrangeRequestError(`Gemini ${res.status}: ${detail}`);
        }
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new MenuArrangeRequestError('Gemini returned no content');
        return JSON.parse(text) as MenuArrangeRaw;
      } catch (err) {
        if (err instanceof MenuArrangeQuotaError) throw err;
        lastError = err instanceof Error ? err : new MenuArrangeRequestError(String(err));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}
