/**
 * RecipePageAgent — 紙面の写真 → 編集可能な RecipeDraft。
 *
 * モデルの返しをそのまま信じない。**保存スキーマの上限に収める**のがここの仕事で、
 * 料理写真（`photo-infer.agent`）と同じ形の `RecipeDraft` を返すので、
 * 端末側は既存の下書き → RecipeForm の経路をそのまま使える。
 *
 * ## 料理写真と受け入れ条件が違う
 *
 * 料理写真は「料理名・材料・手順が揃って初めて下書き」だが、**紙面は揃わないことが普通**。
 * パッケージの裏だけを撮れば料理名は無いし、材料面だけを撮れば手順が無い。
 * それでも確認画面に出して編集させた方がよい（端末内 OCR で同じ判断をしている
 * — `ocr.agent` の `hasUsableDraft()`）。
 * ここでは **材料か手順のどちらかが読めていれば通す**。料理名は空でも通す。
 */
import {
  MAX_RECIPE_PAGE_IMAGES,
  RecipePageConfigError,
  RecipePageRequestError,
  type RecipePageInput,
  type RecipePageProvider,
  type RecipePageRaw,
  type RecipePageRejectReason,
} from '../lib/recipe-page.js';

// Locally-defined contract, mirroring @daidoko/shared. The server tsconfig uses
// a strict rootDir that excludes cross-package source imports (see
// photo-infer.agent.ts, which defines the same shapes locally).
export type RecipePageErrorCode =
  | 'AI_API_UNAVAILABLE'
  | 'RECIPE_PAGE_FAILED'
  /** 紙面にレシピが写っていない（失敗ではなく入力の問題） */
  | 'RECIPE_PAGE_NOT_FOUND'
  | 'RATE_LIMITED';

export interface AgentResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: RecipePageErrorCode; message: string; retryable: boolean };
}

export interface IngredientDraft {
  groupLabel?: string;
  name: string;
  amount?: string;
  note?: string;
}

export interface StepDraft {
  body: string;
}

export interface RecipeDraft {
  title: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients: IngredientDraft[];
  steps: StepDraft[];
  tags?: string[];
  confidence: 'high' | 'medium' | 'low';
}

/**
 * 弾いた理由ごとの文言。**次に何をすればよいかまで書く。**
 * 「読み取れませんでした」だけだと、利用者は同じ写真をもう一度撮る。
 */
const REJECT_MESSAGES: Record<RecipePageRejectReason, string> = {
  no_text:
    '写真に文字が写っていませんでした。レシピが書かれたページや袋の面を撮ってお試しください。',
  unreadable:
    '文字がぶれていて読み取れませんでした。明るい場所で、文字が画面いっぱいになるように撮ってお試しください。',
  no_recipe:
    '材料や作り方が書かれた面が見つかりませんでした。材料と作り方が載っている面も一緒に撮ってお試しください。',
};

const FALLBACK_NOT_FOUND_MESSAGE =
  'レシピを読み取れませんでした。材料と作り方が書かれた面を撮ってお試しください。';

function fail(
  code: RecipePageErrorCode,
  message: string,
  retryable: boolean,
): AgentResult<RecipeDraft> {
  return { ok: false, error: { code, message, retryable } };
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function cleanPositiveInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return undefined;
  return rounded;
}

/**
 * 保存スキーマ（`recipeFormSchema`）の上限に収める。超えた行を落とさず刈り込むのは、
 * この画面が**確認・編集して保存する**前提だから（`docs/レシピ作成フロー.md` §4.3）。
 */
function normalizeDraft(raw: RecipePageRaw): RecipeDraft | null {
  const ingredients = (raw.ingredients ?? [])
    .map((item) => {
      const name = cleanString(item?.name, 50);
      if (!name) return null;
      const groupLabel = cleanString(item?.groupLabel, 30);
      const amount = cleanString(item?.amount, 30);
      const note = cleanString(item?.note, 100);
      return {
        name,
        ...(groupLabel !== undefined && { groupLabel }),
        ...(amount !== undefined && { amount }),
        ...(note !== undefined && { note }),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const steps = (raw.steps ?? [])
    .map((item) => {
      const body = cleanString(item?.body, 500);
      return body ? { body } : null;
    })
    .filter((item): item is { body: string } => item !== null);

  // 紙面は片面だけを撮ることが普通なので、**材料か手順のどちらかが読めていれば通す**。
  // 料理名だけでは通さない（見出しを読んだだけで中身が無い下書きになる）。
  if (ingredients.length === 0 && steps.length === 0) return null;

  const titleReading = cleanString(raw.titleReading, 100);
  const description = cleanString(raw.description, 500);
  const servings = cleanPositiveInt(raw.servings, 1, 99);
  const cookTimeMin = cleanPositiveInt(raw.cookTimeMin, 1, 999);
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => cleanString(tag, 30))
        .filter((tag): tag is string => tag !== undefined)
        .slice(0, 10)
    : [];
  const confidence =
    raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
      ? raw.confidence
      : 'low';

  return {
    // 紙面に料理名が無いことは普通にある。空のまま返し、端末側で入力させる
    title: cleanString(raw.title, 100) ?? '',
    ...(titleReading !== undefined && { titleReading }),
    ...(description !== undefined && { description }),
    ...(servings !== undefined && { servings }),
    ...(cookTimeMin !== undefined && { cookTimeMin }),
    ingredients,
    steps,
    ...(tags.length > 0 && { tags }),
    confidence,
  };
}

export async function runRecipePageAgent(
  input: RecipePageInput,
  provider: RecipePageProvider,
): Promise<AgentResult<RecipeDraft>> {
  if (input.images.length === 0) {
    return fail('RECIPE_PAGE_FAILED', '写真がありません', false);
  }
  if (input.images.length > MAX_RECIPE_PAGE_IMAGES) {
    return fail('RECIPE_PAGE_FAILED', `写真は ${MAX_RECIPE_PAGE_IMAGES} 枚までです`, false);
  }

  let raw: RecipePageRaw;
  try {
    raw = await provider.read(input);
  } catch (err) {
    if (err instanceof RecipePageConfigError) {
      return fail('AI_API_UNAVAILABLE', 'AI 読み取りが利用できません', false);
    }
    if (err instanceof RecipePageRequestError) {
      return fail('AI_API_UNAVAILABLE', 'AI 読み取りサービスへの接続に失敗しました', true);
    }
    return fail(
      'RECIPE_PAGE_FAILED',
      err instanceof Error ? err.message : '紙面の読み取りに失敗しました',
      true,
    );
  }

  if (!raw.found) {
    const reason = raw.rejectReason;
    const message =
      reason !== undefined && reason in REJECT_MESSAGES
        ? REJECT_MESSAGES[reason]
        : FALLBACK_NOT_FOUND_MESSAGE;
    return fail('RECIPE_PAGE_NOT_FOUND', message, false);
  }

  const draft = normalizeDraft(raw);
  if (!draft) {
    return fail('RECIPE_PAGE_NOT_FOUND', FALLBACK_NOT_FOUND_MESSAGE, false);
  }

  return { ok: true, data: draft };
}
