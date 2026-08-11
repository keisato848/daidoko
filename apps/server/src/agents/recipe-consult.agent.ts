/**
 * RecipeConsultAgent — 作りたいものを相談してレシピの下書きにする。
 *
 * 写真レシピ・感想調整と同じ `AgentResult` 契約を返すので、モバイル側は既存の
 * draft → RecipeForm のマッピングをそのまま使える。違いは会話の返事（`reply`）と、
 * **下書きがまだ無い状態が正当**なこと（質問だけ返る往復がある）。
 */
import {
  ConsultConfigError,
  ConsultQuotaError,
  ConsultRequestError,
  type ConsultRecipeInput,
  type ConsultRecipeRaw,
  type RecipeConsultProvider,
} from '../lib/recipe-consult.js';
import type { AgentErrorCode, AgentResult, RecipeDraft } from './photo-infer.agent.js';

/** 相談の 1 往復ぶんの結果。 */
export interface ConsultTurn {
  /** 相談相手としての返事。会話に積む */
  reply: string;
  /** 保存できる状態か。true でも保存はユーザーの操作を待つ */
  ready: boolean;
  /** 現時点の下書き。まだ出せない往復では null */
  draft: RecipeDraft | null;
}

const EMPTY_REPLY_MESSAGE =
  'うまく聞き取れませんでした。作りたいものを、ひとことで教えてください。';

function fail(code: AgentErrorCode, message: string, retryable: boolean): AgentResult<ConsultTurn> {
  return { ok: false, error: { code, message, retryable } };
}

/**
 * 構造化出力でも `"null"` / `"undefined"` という**文字列**が返ることがある（実測）。
 * そのまま入れると材料の備考が「null」になるので、空として扱う。
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

/**
 * 下書きとして成立しているか。**材料か手順のどちらかが空なら下書きとして返さない** —
 * 半端な下書きを出すと「保存できそうに見えるのに保存できない」状態になる。
 */
function normalizeDraft(raw: ConsultRecipeRaw['draft']): RecipeDraft | null {
  if (!raw) return null;
  const title = cleanString(raw.title, 100);
  if (!title) return null;

  const ingredients = (raw.ingredients ?? [])
    .map((ing) => {
      const name = cleanString(ing?.name, 50);
      if (!name) return null;
      return {
        name,
        ...(cleanString(ing?.groupLabel, 30) !== undefined && {
          groupLabel: cleanString(ing?.groupLabel, 30) as string,
        }),
        ...(cleanString(ing?.amount, 30) !== undefined && {
          amount: cleanString(ing?.amount, 30) as string,
        }),
        ...(cleanString(ing?.note, 100) !== undefined && {
          note: cleanString(ing?.note, 100) as string,
        }),
      };
    })
    .filter((ing): ing is NonNullable<typeof ing> => ing !== null);

  const steps = (raw.steps ?? [])
    .map((step) => cleanString(step?.body, 500))
    .filter((body): body is string => body !== undefined)
    .map((body) => ({ body }));

  if (ingredients.length === 0 || steps.length === 0) return null;

  return {
    title,
    ...(cleanString(raw.titleReading, 100) !== undefined && {
      titleReading: cleanString(raw.titleReading, 100) as string,
    }),
    ...(cleanString(raw.description, 500) !== undefined && {
      description: cleanString(raw.description, 500) as string,
    }),
    ...(cleanPositiveInt(raw.servings, 99) !== undefined && {
      servings: cleanPositiveInt(raw.servings, 99) as number,
    }),
    ...(cleanPositiveInt(raw.cookTimeMin, 999) !== undefined && {
      cookTimeMin: cleanPositiveInt(raw.cookTimeMin, 999) as number,
    }),
    ingredients,
    steps,
    ...(Array.isArray(raw.tags) && {
      tags: raw.tags
        .map((tag) => cleanString(tag, 30))
        .filter((tag): tag is string => tag !== undefined)
        .slice(0, 10),
    }),
    // 会話で本人が決めた内容なので、写真からの推測より確からしい
    confidence: 'high',
  };
}

export async function runRecipeConsultAgent(
  input: ConsultRecipeInput,
  provider: RecipeConsultProvider,
): Promise<AgentResult<ConsultTurn>> {
  if (input.messages.length === 0) {
    return fail('UNKNOWN', '相談する内容がありません', false);
  }

  let raw: ConsultRecipeRaw;
  try {
    raw = await provider.consult(input);
  } catch (err) {
    if (err instanceof ConsultConfigError) {
      return fail('AI_API_UNAVAILABLE', 'AI 推論が利用できません', false);
    }
    if (err instanceof ConsultQuotaError) {
      return fail('AI_QUOTA_EXCEEDED', '本日の利用上限に達しました', false);
    }
    if (err instanceof ConsultRequestError) {
      return fail('PHOTO_RECIPE_FAILED', 'AI 推論に失敗しました', true);
    }
    return fail('PHOTO_RECIPE_FAILED', 'AI 推論に失敗しました', true);
  }

  const draft = normalizeDraft(raw.draft);
  return {
    ok: true,
    data: {
      reply: cleanString(raw.reply, 1000) ?? EMPTY_REPLY_MESSAGE,
      // 下書きが無いのに ready を信じると、保存できないのに保存ボタンが出る
      ready: raw.ready === true && draft !== null,
      draft,
    },
  };
}
