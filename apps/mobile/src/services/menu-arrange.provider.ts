/**
 * AI 献立並べ替え（M2・クライアント側）。
 *
 * 在庫から機械的に組んだ X 日分の献立（M1・`utils/menuPlan.ts`）を、AI に「並べ替えて」
 * もらう 1 操作だけの機能。**呼ぶのは「組む」1 操作につき 1 回。差し替えでは絶対に呼ばない**
 * （`docs/買い物リスト・在庫設計.md` §10.5）。空・失敗・枠切れは呼び出し側が M1 の並びを
 * そのまま使う（このファイルは失敗を投げるだけで、M1 の状態には一切触らない）。
 *
 * プロンプト・responseSchema・検証（`validateArrangement`）はサーバー
 * `apps/server/src/lib/menu-arrange.ts` の写し。**片方だけ直さないこと。**
 * BYOK（自分の Gemini キー）が設定されていれば直接、無ければ managed サーバー経由
 * （`recipe-consult.provider.ts` と同じ形。画像を送らないので FileSystem / preprocess は無い分薄い）。
 */
import { API_V1, GEMINI_MODEL } from '../config';
import { t } from '../i18n';
import { serverErrorFor } from './ai-error';
import { requestLocale, withOutputLanguage } from './ai-output-locale';
import { getInstallationId } from './app-meta.service';
import { getUserApiKey } from './byok.service';
import { resolveQuotaSource } from './usage.service';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 45_000;

/** 1 リクエストに渡す候補の上限。サーバー側 `MAX_MENU_CANDIDATES` と揃える。 */
export const MAX_ARRANGE_CANDIDATES = 30;

export interface MenuCandidate {
  /** 端末ローカルの recipes.id。サーバーは解釈せず echo するだけ */
  id: string;
  title: string;
  cookTimeMin?: number;
  /** カバー率（%）。整数 0..100 */
  coveragePct: number;
  /** 不足材料の名前だけ。数量は契約上渡さない */
  missing: string[];
}

export interface MenuArrangeInput {
  /** ≤30 件（サーバー・BYOK どちらも `arrangeMenu` が保証する） */
  candidates: MenuCandidate[];
  /** 手元の在庫の**品名だけ**（数量は渡さない＝引き算を始めさせない） */
  pantry: string[];
  /** 直近に作った料理名（日付は渡さない） */
  recentTitles?: string[];
  days: number;
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

/**
 * ConsultError と同形。**kind 等の追加フィールドは持たせない**（§10.10.6-e —
 * 既存の ConsultError / ReceiptVisionError も retryable のみで、文言の出し分けは
 * throw する側で `t()` によりメッセージへ焼き込む）。
 */
export class MenuArrangeError extends Error {
  /** t() 済みの文言を持つ印（ai-error.ts） */
  readonly userVisible = true;
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'MenuArrangeError';
    this.retryable = retryable;
  }
}

// ─── プロンプト・responseSchema（サーバー側の写し。片方だけ直さないこと） ──────────

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
  '   同じ系統（例: カレー同士・洋食同士）を 2 日以上連続させない。似たタイトル',
  '   （カレー 3 種など）は、間に別系統を挟む。',
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
  '- 「週末」「平日」「何曜日」という語を why に書く（何曜日に作るかは渡されていない。',
  '  最終日だからといって週末とは限らない）。',
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
  required: ['days'],
  propertyOrdering: ['days', 'note'],
};

/** 入力を 1 つの user メッセージにまとめる（§10.10.2 の buildMenuContext の写し）。 */
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

// ─── 検証（`sanitizeMenuDays` の写し・§10.10.3） ───────────────────────────

/**
 * why の禁止パターン（正規表現・ja/en 両方）。サーバー `menu-arrange.ts` の
 * `BANNED_WHY_PATTERNS` の写し——評価 2 周目（docs/eval/menu-rank/2026-08-29-round2-*）で
 * 「週末」への言及がプロンプト遵守だけでは 0 件にならなかったため追加した、プロンプトを
 * 信用しない側の決定的な防御。片方だけ直さないこと。
 */
export const BANNED_WHY_PATTERNS: { name: string; regex: RegExp }[] = [
  {
    name: '数量単位',
    regex:
      /\d+\s*(g|kg|ml|cc|個|本|枚|かけ|合|丁|袋|缶|パック|大さじ|小さじ|カップ|cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|pounds?|lbs?|grams?)/i,
  },
  { name: 'カロリー/栄養', regex: /カロリー|栄養|nutrition|calorie/i },
  { name: '期限/鮮度', regex: /期限|賞味|消費期限|鮮度|旬|expir|fresh/i },
  { name: '曜日', regex: /曜日|週末|平日|weekday|weekend/i },
  { name: '節約', regex: /節約|安上がり|安く済|cheap|budget/i },
];

function isBannedWhy(value: string): boolean {
  return BANNED_WHY_PATTERNS.some(({ regex }) => regex.test(value));
}

/** `cleanWhy`（サーバー側）の写し。禁止パターンに掛かる why は行ごと捨てず、why だけ undefined に落とす。 */
function cleanWhy(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (isBannedWhy(trimmed)) return undefined; // 決定的な防御。行は生かし why だけ落とす
  return trimmed.slice(0, 100);
}

interface RawDayPick {
  day?: unknown;
  recipeId?: unknown;
  why?: unknown;
}

interface RawArrangement {
  days?: unknown;
  note?: unknown;
}

/**
 * モデルの生出力を検証する。BYOK 経路はサーバーを通らないので必須で、managed 応答にも
 * **防御的に**通す（[client-must-survive-server-skew]）。ルールは §10.10.3 のとおり:
 * 1. 渡していない recipeId → 捨てる（ハルシネーション遮断）
 * 2. day が 1..dayCount の整数でない → 捨てる
 * 3. 同じ day の 2 件目以降 → 捨てる（先勝ち）
 * 4. 同じ recipeId の 2 日目以降 → 捨てる（M1 の「1 レシピ 1 日」不変条件を AI 出力にも通す）
 * 5. why は文字列整形（上限 100 字で切る）。無ければ undefined。**`BANNED_WHY_PATTERNS` に
 *    掛かる why は行ごと捨てず、why だけ undefined に落とす**（プロンプトが破られても表示は
 *    必ず守る。M1 の機械的理由への差し替えは呼び出し側の仕事）
 * 6. day 昇順に整列。dayCount 未満でも埋めない
 */
export function validateArrangement(
  raw: RawArrangement | null | undefined,
  candidateIds: ReadonlySet<string>,
  dayCount: number,
): MenuArrangement {
  const rawDays: RawDayPick[] = Array.isArray(raw?.days) ? (raw.days as RawDayPick[]) : [];
  const seenDays = new Set<number>();
  const seenRecipeIds = new Set<string>();
  const picks: MenuDayPick[] = [];

  for (const entry of rawDays) {
    const recipeId = entry?.recipeId;
    if (typeof recipeId !== 'string' || !candidateIds.has(recipeId)) continue; // 1
    const day = entry?.day;
    if (!Number.isInteger(day) || (day as number) < 1 || (day as number) > dayCount) continue; // 2
    if (seenDays.has(day as number)) continue; // 3
    if (seenRecipeIds.has(recipeId)) continue; // 4
    seenDays.add(day as number);
    seenRecipeIds.add(recipeId);

    const why = cleanWhy(entry?.why); // 5
    picks.push({ day: day as number, recipeId, ...(why !== undefined && { why }) });
  }

  picks.sort((a, b) => a.day - b.day); // 6

  // note も 200 字で切る（サーバー agents/menu-arrange.agent.ts の cleanNote の写し。片方だけ直さないこと）
  const trimmedNote = typeof raw?.note === 'string' ? raw.note.trim().slice(0, 200) : '';
  const note = trimmedNote ? trimmedNote : undefined;
  return { days: picks, ...(note ? { note } : {}) };
}

// ─── BYOK（自分のキーで直接） ────────────────────────────────────────────────

async function arrangeViaByok(input: MenuArrangeInput, apiKey: string): Promise<MenuArrangement> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // systemInstruction は withOutputLanguage のみ（withUnitSystem は呼ばない —
        // 分量を出力しない推論への単位系指示は「分量を書け」という圧力になるだけ・§10.5）
        systemInstruction: { parts: [{ text: withOutputLanguage(SYSTEM_PROMPT) }] },
        contents: [{ role: 'user', parts: [{ text: buildMenuContext(input) }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });
    if (res.status === 429) throw new MenuArrangeError(t('ai.error.byokQuota'), false);
    if (!res.ok) {
      const info = serverErrorFor(res.status);
      throw new MenuArrangeError(info.message, info.retryable);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new MenuArrangeError(t('menu.ai.failed'), true);
    const raw = JSON.parse(text) as RawArrangement;
    const candidateIds = new Set(input.candidates.map((c) => c.id));
    return validateArrangement(raw, candidateIds, input.days);
  } catch (err) {
    if (err instanceof MenuArrangeError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MenuArrangeError(t('ai.error.timeout'), true);
    }
    throw new MenuArrangeError(t('error.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

// ─── managed サーバー経由 ────────────────────────────────────────────────────

interface ServerAgentResult {
  ok: boolean;
  data?: { days: MenuDayPick[]; note?: string };
  error?: { code: string; message: string; retryable: boolean };
}

async function arrangeViaServer(input: MenuArrangeInput): Promise<MenuArrangement> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // x-device-id は必ず送る。付け忘れると AI 経路が永久に無言で M1 へ落ち、
    // 誰も気づけない（手がかりが source:"coverage" しか残らないため・§10.10.3）
    const [deviceId, quotaSource] = await Promise.all([getInstallationId(), resolveQuotaSource()]);
    const res = await fetch(`${API_V1}/infer/menu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
        // 広告トークンで実行するとき（月次無料枠を使い切っている）は 'token'、
        // プレミアムは 'premium'。それ以外は付けず、サーバー側の月次枠チェックに乗せる（§10.10.7-2）
        ...(quotaSource ? { 'x-quota-source': quotaSource } : {}),
      },
      body: JSON.stringify({
        candidates: input.candidates,
        pantry: input.pantry,
        ...(input.recentTitles && input.recentTitles.length > 0
          ? { recentTitles: input.recentTitles }
          : {}),
        days: input.days,
        locale: requestLocale(),
        // unitSystem は載せない（§10.5・§10.10.1 — 他ルートとの意図的な差分）
      }),
      signal: controller.signal,
    });
    // /infer/menu 未デプロイの 404 も含め、想定外の HTTP ステータスは例外を握って
    // 呼び出し側（menu.tsx）が M1 の並びへ落とす（[client-must-survive-server-skew]）
    if (!res.ok) {
      const info = serverErrorFor(res.status);
      throw new MenuArrangeError(info.message, info.retryable);
    }
    const result = (await res.json()) as ServerAgentResult;
    if (!result.ok || !result.data) {
      const quota =
        result.error?.code === 'AI_QUOTA_EXCEEDED' ||
        result.error?.code === 'RATE_LIMITED' ||
        result.error?.code === 'FREE_QUOTA_EXCEEDED';
      throw new MenuArrangeError(
        quota ? t('error.quotaExceeded') : t('menu.ai.failed'),
        result.error?.retryable ?? true,
      );
    }
    const candidateIds = new Set(input.candidates.map((c) => c.id));
    // managed 応答にも防御的に validateArrangement を通す（BYOK 側と同じ関数で通す）
    return validateArrangement(result.data, candidateIds, input.days);
  } catch (err) {
    if (err instanceof MenuArrangeError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MenuArrangeError(t('ai.error.timeout'), true);
    }
    throw new MenuArrangeError(t('error.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 献立を AI に並べ替えてもらう。BYOK があれば自分のキーで直接、無ければサーバー経由。
 * **呼ぶのは「組む」1 操作につき 1 回。差し替えでは絶対に呼ばない**（§10.5）。
 * 空・失敗・枠切れの扱い（M1 へ落とす）は呼び出し側の責務 — ここは投げるだけ。
 */
export async function arrangeMenu(input: MenuArrangeInput): Promise<MenuArrangement> {
  const bounded: MenuArrangeInput = {
    ...input,
    candidates: input.candidates.slice(0, MAX_ARRANGE_CANDIDATES),
  };
  const userKey = await getUserApiKey();
  return userKey ? arrangeViaByok(bounded, userKey) : arrangeViaServer(bounded);
}
