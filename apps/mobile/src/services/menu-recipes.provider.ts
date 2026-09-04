/**
 * 献立の不足分レシピを AI で一括生成する（M3・クライアント側）。
 *
 * 献立の要求日数に手持ちレシピが届かないとき、不足の n 品を **1 回の呼び出しで**
 * まとめて作る（M3-3「一括 = 無料枠 1 回分」の原価根拠。品数分呼ばない）。
 * 生成は提案であって自動確定にしない（M3-1）— このファイルは下書きを返すだけで、
 * 保存・献立への組み込みは呼び出し側（menu.tsx の提案シート確定）がやる。
 *
 * プロンプト・responseSchema・検証（`validateMenuRecipeDrafts`）はサーバー
 * `apps/server/src/lib/menu-recipes.ts` の写し。契約の正は
 * `packages/shared/src/types/menu-recipes.ts`。**片方だけ直さないこと。**
 * BYOK（自分の Gemini キー）が設定されていれば直接、無ければ managed サーバー経由
 * （`menu-arrange.provider.ts` と同じ形）。
 */
import {
  MAX_MENU_RECIPES_DAYS,
  MAX_MENU_RECIPES_PANTRY,
  MAX_MENU_RECIPES_PREFERENCES,
  MAX_MENU_RECIPES_TITLES,
  type MenuRecipeDraft,
} from '@daidoko/shared';

import { API_V1, GEMINI_MODEL } from '../config';
import { t } from '../i18n';
import {
  requestLocale,
  requestUnitSystem,
  withOutputLanguage,
  withUnitSystem,
} from './ai-output-locale';
import { getInstallationId } from './app-meta.service';
import { getUserApiKey } from './byok.service';
import { resolveQuotaSource } from './usage.service';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// n 品まとめて書かせるぶん出力が長い（サーバー側 Gemini タイムアウト 60s より長く待つ）
const TIMEOUT_MS = 90_000;

export type { MenuRecipeDraft };

export interface MenuRecipesArgs {
  /** 不足日数 = 生成する品数（1〜7） */
  days: number;
  /** 手持ちレシピのタイトル（重複回避用・≤30 は `generateMenuRecipes` が保証する） */
  existingTitles: string[];
  /** 在庫の**品名だけ**（数量は渡さない・≤50 は同上） */
  pantry: string[];
  /** 家族の嗜好メモ（S21・任意・≤400 字は同上） */
  preferences?: string;
}

/** MenuArrangeError と同形（retryable のみ。文言は throw 側で `t()` により焼き込む）。 */
export class MenuRecipesError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'MenuRecipesError';
    this.retryable = retryable;
  }
}

// ─── プロンプト・responseSchema（サーバー側の写し。片方だけ直さないこと） ──────────

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

/** 入力を 1 つの user メッセージにまとめる（サーバー `buildMenuRecipesContext` の写し）。 */
export function buildMenuRecipesContext(args: MenuRecipesArgs): string {
  const preferences = args.preferences?.trim();
  return [
    '## 作る品数',
    String(args.days),
    '## 手持ちのレシピ（これと被らないこと）',
    args.existingTitles.slice(0, MAX_MENU_RECIPES_TITLES).join('、') || '（まだ無い）',
    '## 在庫にある品名',
    args.pantry.slice(0, MAX_MENU_RECIPES_PANTRY).join('、') || '（在庫は空）',
    '## 家族の好み・避けたいもの',
    preferences || '（指定なし）',
  ].join('\n');
}

// ─── 検証（サーバー `sanitizeMenuRecipeDrafts` の写し） ───────────────────────

interface RawIngredient {
  name?: unknown;
  amount?: unknown;
}

interface RawStep {
  body?: unknown;
}

interface RawDraft {
  title?: unknown;
  description?: unknown;
  servings?: unknown;
  cookTimeMin?: unknown;
  ingredients?: unknown;
  steps?: unknown;
  tags?: unknown;
}

interface RawMenuRecipes {
  recipes?: unknown;
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
 * モデルの生出力を検証する。BYOK 経路はサーバーを通らないので必須で、managed 応答にも
 * **防御的に**通す（menu-arrange.provider の `validateArrangement` と同じ役割分担）。
 * 規則は捨てる方向のみ・埋めない:
 * 1. title 無し・材料空・手順空の品 → 捨てる（半端な下書きは保存できない）
 * 2. 手持ちレシピと同名（正規化一致）の品 → 捨てる（重複回避の決定的防御）
 * 3. 生成結果同士の同名 → 2 品目以降を捨てる
 * 4. days を超えたぶん → 捨てる
 * 5. 各フィールドは consult と同じ上限で整形（title 100・材料名 50・分量 30・手順 500 等）
 */
export function validateMenuRecipeDrafts(
  raw: RawMenuRecipes | null | undefined,
  existingTitles: readonly string[],
  days: number,
): MenuRecipeDraft[] {
  const rawDrafts: RawDraft[] = Array.isArray(raw?.recipes) ? (raw.recipes as RawDraft[]) : [];
  const taken = new Set(existingTitles.map(normalizeTitle));
  const drafts: MenuRecipeDraft[] = [];

  for (const item of rawDrafts) {
    if (drafts.length >= days) break; // 4

    const title = cleanString(item?.title, 100);
    if (!title) continue; // 1

    const rawIngredients: RawIngredient[] = Array.isArray(item?.ingredients)
      ? (item.ingredients as RawIngredient[])
      : [];
    const ingredients = rawIngredients
      .map((ing) => {
        const name = cleanString(ing?.name, 50);
        if (!name) return null;
        const amount = cleanString(ing?.amount, 30);
        return { name, ...(amount !== undefined && { amount }) };
      })
      .filter((ing): ing is NonNullable<typeof ing> => ing !== null);

    const rawSteps: RawStep[] = Array.isArray(item?.steps) ? (item.steps as RawStep[]) : [];
    const steps = rawSteps
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
      ? (item.tags as unknown[])
          .map((tag) => cleanString(tag, 30))
          .filter((tag): tag is string => tag !== undefined)
          .slice(0, 10)
      : [];

    drafts.push({
      title,
      ...(description !== undefined && { description }),
      ...(servings !== undefined && { servings }),
      ...(cookTimeMin !== undefined && { cookTimeMin }),
      ingredients,
      steps,
      ...(tags.length > 0 && { tags }),
    });
  }

  return drafts;
}

// ─── BYOK（自分のキーで直接） ────────────────────────────────────────────────

async function generateViaByok(args: MenuRecipesArgs, apiKey: string): Promise<MenuRecipeDraft[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 分量を書かせる推論なので consult と同様に単位系も指示する（menu-arrange との差分）
        systemInstruction: { parts: [{ text: withUnitSystem(withOutputLanguage(SYSTEM_PROMPT)) }] },
        contents: [{ role: 'user', parts: [{ text: buildMenuRecipesContext(args) }] }],
        generationConfig: {
          temperature: 0.6,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });
    if (res.status === 429) throw new MenuRecipesError(t('ai.error.byokQuota'), false);
    if (!res.ok) {
      throw new MenuRecipesError(
        t('ai.error.serverError', { status: res.status }),
        res.status >= 500,
      );
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new MenuRecipesError(t('menu.bulk.failed'), true);
    const raw = JSON.parse(text) as RawMenuRecipes;
    return validateMenuRecipeDrafts(raw, args.existingTitles, args.days);
  } catch (err) {
    if (err instanceof MenuRecipesError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MenuRecipesError(t('ai.error.timeout'), true);
    }
    throw new MenuRecipesError(t('error.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

// ─── managed サーバー経由 ────────────────────────────────────────────────────

interface ServerAgentResult {
  ok: boolean;
  data?: { recipes: unknown };
  error?: { code: string; message: string; retryable: boolean };
}

async function generateViaServer(args: MenuRecipesArgs): Promise<MenuRecipeDraft[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // x-device-id は必ず送る（付け忘れるとサーバーが即 ok:false を返す・§10.10.3 と同じ罠）
    const [deviceId, quotaSource] = await Promise.all([getInstallationId(), resolveQuotaSource()]);
    const res = await fetch(`${API_V1}/infer/menu-recipes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
        // 広告トークン実行時は 'token'・プレミアムは 'premium'。それ以外は付けず、
        // サーバー側の月次枠チェックに乗せる（/infer/menu と同じ・§10.10.7-2）
        ...(quotaSource ? { 'x-quota-source': quotaSource } : {}),
      },
      body: JSON.stringify({
        days: args.days,
        existingTitles: args.existingTitles,
        pantry: args.pantry,
        ...(args.preferences ? { preferences: args.preferences } : {}),
        locale: requestLocale(),
        unitSystem: requestUnitSystem(),
      }),
      signal: controller.signal,
    });
    // /infer/menu-recipes 未デプロイの 404 も含め、想定外の HTTP ステータスは例外にして
    // 呼び出し側がエラー文言だけ出す（プランには触らない・[client-must-survive-server-skew]）
    if (!res.ok) {
      throw new MenuRecipesError(
        t('ai.error.serverError', { status: res.status }),
        res.status >= 500,
      );
    }
    const result = (await res.json()) as ServerAgentResult;
    if (!result.ok || !result.data) {
      const quota =
        result.error?.code === 'AI_QUOTA_EXCEEDED' ||
        result.error?.code === 'RATE_LIMITED' ||
        result.error?.code === 'FREE_QUOTA_EXCEEDED';
      throw new MenuRecipesError(
        quota ? t('error.quotaExceeded') : t('menu.bulk.failed'),
        result.error?.retryable ?? true,
      );
    }
    // managed 応答にも防御的に検証を通す（BYOK 側と同じ関数で通す）
    return validateMenuRecipeDrafts(
      { recipes: result.data.recipes },
      args.existingTitles,
      args.days,
    );
  } catch (err) {
    if (err instanceof MenuRecipesError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MenuRecipesError(t('ai.error.timeout'), true);
    }
    throw new MenuRecipesError(t('error.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 不足分のレシピ下書きを一括生成する。BYOK があれば自分のキーで直接、無ければ
 * サーバー経由。**1 操作 = 1 呼び出し**（M3-3）。空・失敗の扱い（エラー文言だけ出し、
 * プランに触らない）は呼び出し側の責務 — ここは投げるだけ。
 */
export async function generateMenuRecipes(args: MenuRecipesArgs): Promise<MenuRecipeDraft[]> {
  const bounded: MenuRecipesArgs = {
    days: Math.max(1, Math.min(MAX_MENU_RECIPES_DAYS, Math.floor(args.days))),
    existingTitles: args.existingTitles.slice(0, MAX_MENU_RECIPES_TITLES),
    pantry: args.pantry.slice(0, MAX_MENU_RECIPES_PANTRY),
    ...(args.preferences?.trim()
      ? { preferences: args.preferences.trim().slice(0, MAX_MENU_RECIPES_PREFERENCES) }
      : {}),
  };
  const userKey = await getUserApiKey();
  return userKey ? generateViaByok(bounded, userKey) : generateViaServer(bounded);
}
