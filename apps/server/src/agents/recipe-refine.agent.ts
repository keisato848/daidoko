/**
 * RecipeRefineAgent — server-side「感想でレシピを店の味に近づける」.
 *
 * 写真レシピ（photo-infer.agent）と同じ AgentResult / RecipeDraft 契約を返すので、
 * モバイル側は既存の draft → RecipeForm マッピングを再利用できる。
 * 違いは `changeSummary`（何をどう変えたか）が付くこと。
 */
import {
  RefineConfigError,
  RefineQuotaError,
  RefineRequestError,
  type RecipeRefineProvider,
  type RefineRecipeInput,
  type RefineRecipeRaw,
} from '../lib/recipe-refine.js';
import type { AgentErrorCode, AgentResult, RecipeDraft } from './photo-infer.agent.js';

/** 調整結果。draft は**変更後のレシピ全体**（差分ではない）。 */
export interface RefinedRecipe {
  draft: RecipeDraft;
  /** 何をどう変えたか。差分プレビューの見出しに使う */
  changeSummary: string;
}

const NO_CHANGE_MESSAGE =
  '感想から、何をどう変えればよいか読み取れませんでした。「甘すぎた」「もっと辛く」のように、味の方向を書いてみてください。';

function fail(
  code: AgentErrorCode,
  message: string,
  retryable: boolean,
): AgentResult<RefinedRecipe> {
  return { ok: false, error: { code, message, retryable } };
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  // 構造化出力でも "null" / "undefined" という文字列が返ることがある（実測）。
  // そのまま入れると材料の備考が「null」になるので、空として扱う
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return undefined;
  return trimmed.slice(0, max);
}

function cleanPositiveInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded < min || rounded > max ? undefined : rounded;
}

/**
 * モデル出力を RecipeDraft に整える。
 *
 * 現行レシピを base として渡し、**モデルが省いたフィールドは base の値を残す**。
 * 「指示された点だけを変える」という契約は、モデルの善意だけに任せず
 * ここでも担保する（省略 = 変更なし、として扱う）。
 */
export function normalizeRefined(
  raw: RefineRecipeRaw,
  base: RefineRecipeInput['recipe'],
): RecipeDraft | null {
  // 材料ごとの省略も base で埋める。実測では、感想と無関係な材料の amount を
  // 丸ごと落とした応答が返ることがあった（分量が消えるのは黙った書き換えと同じ）。
  // プロンプトで戒めるより、名前で突き合わせてコードで担保する方が確実。
  const baseByName = new Map(base.ingredients.map((ing) => [ing.name.trim(), ing]));

  const ingredients = (raw.ingredients ?? [])
    .map((item) => {
      const name = cleanString(item?.name, 50);
      if (!name) return null;
      const original = baseByName.get(name);
      const groupLabel = cleanString(item?.groupLabel, 30) ?? original?.groupLabel;
      const amount = cleanString(item?.amount, 30) ?? original?.amount;
      // 分量が変わっていない材料の note は**元のまま**にする。
      // 実機で、水を 200→220ml にしただけなのに、他の全材料へ「（ドレッシング）」
      // 「（生地用）」といった注記が足され、差分がほぼ全材料で「変更」になった。
      // そうなると「ここに出ていない材料は変わっていません」が意味を失い、
      // **本当の変更を見つけられなくなる**（差分プレビューは黙った書き換えを防ぐ仕組みなので致命的）。
      // 感想は味や見た目についてのものなので、注記だけの変更が求められることはない。
      // 説明したいことは changeSummary に書けばよい。
      const amountUnchanged = original !== undefined && amount === original.amount;
      const note = amountUnchanged
        ? original.note
        : (cleanString(item?.note, 100) ?? original?.note);
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

  // 材料・手順が返ってこない／全滅した場合は調整結果として使えない。
  // base で埋めてしまうと「AI が直した」と偽ることになるので null を返す。
  if (ingredients.length === 0 || steps.length === 0) return null;

  const title = cleanString(raw.title, 100) ?? base.title;
  const titleReading = cleanString(raw.titleReading, 100);
  const description = cleanString(raw.description, 500) ?? base.description;
  const servings = cleanPositiveInt(raw.servings, 1, 99) ?? base.servings;
  const cookTimeMin = cleanPositiveInt(raw.cookTimeMin, 1, 999) ?? base.cookTimeMin;
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => cleanString(tag, 30))
        .filter((tag): tag is string => tag !== undefined)
        .slice(0, 10)
    : (base.tags ?? []);

  return {
    title,
    ...(titleReading !== undefined && { titleReading }),
    ...(description !== undefined && { description }),
    ...(servings !== undefined && { servings }),
    ...(cookTimeMin !== undefined && { cookTimeMin }),
    ingredients,
    steps,
    ...(tags.length > 0 && { tags }),
    // 既存レシピの調整なので、写真からの推論のような不確かさはない
    confidence: 'high',
  };
}

export async function runRecipeRefineAgent(
  input: RefineRecipeInput,
  provider: RecipeRefineProvider,
): Promise<AgentResult<RefinedRecipe>> {
  let raw: RefineRecipeRaw;
  try {
    raw = await provider.refine(input);
  } catch (err) {
    if (err instanceof RefineConfigError) {
      return fail('AI_API_UNAVAILABLE', 'AI 推論が利用できません', false);
    }
    // RefineQuotaError は RefineRequestError の派生なので、先に判定する
    if (err instanceof RefineQuotaError) {
      return fail(
        'AI_QUOTA_EXCEEDED',
        '本日の AI 利用上限に達しました。時間をおいてお試しください。',
        false,
      );
    }
    if (err instanceof RefineRequestError) {
      return fail('AI_API_UNAVAILABLE', 'AI 推論サービスへの接続に失敗しました', true);
    }
    return fail(
      'PHOTO_RECIPE_FAILED',
      err instanceof Error ? err.message : 'レシピの調整に失敗しました',
      true,
    );
  }

  // 感想から変更点を読み取れなかった場合。**推測で書き換えさせない。**
  // 何を書けばよいかまで伝える（繰り返しを促すだけでは改善できない）。
  if (!raw.changed) {
    return fail(
      'REFINE_NO_CHANGE',
      cleanString(raw.changeSummary, 300) ?? NO_CHANGE_MESSAGE,
      false,
    );
  }

  const draft = normalizeRefined(raw, input.recipe);
  if (!draft) {
    return fail(
      'PHOTO_RECIPE_FAILED',
      '調整結果をレシピに変換できませんでした。もう一度お試しください。',
      true,
    );
  }

  return {
    ok: true,
    data: { draft, changeSummary: cleanString(raw.changeSummary, 300) ?? 'レシピを調整しました。' },
  };
}
