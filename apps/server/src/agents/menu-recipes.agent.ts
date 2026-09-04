/**
 * MenuRecipesAgent — 献立の不足分レシピを AI で一括生成する（M3・§10.12）。
 *
 * `MenuArrangeAgent` と同じ `AgentResult` 契約。**AI 呼び出しが成功しても、
 * 検証（`sanitizeMenuRecipeDrafts`）で全滅したら ok:false を返す** —
 * ok:true で空配列を返すと、クライアントが「成功したのに 0 品」を成功として
 * 扱い、無料枠だけ消費される事故につながる。
 */
import {
  MenuRecipesConfigError,
  MenuRecipesQuotaError,
  MenuRecipesRequestError,
  sanitizeMenuRecipeDrafts,
  type MenuRecipeDraft,
  type MenuRecipesInput,
  type MenuRecipesProvider,
  type MenuRecipesRaw,
} from '../lib/menu-recipes.js';
import type { AgentErrorCode, AgentResult } from './photo-infer.agent.js';

export interface MenuRecipesResult {
  recipes: MenuRecipeDraft[];
}

function fail(
  code: AgentErrorCode,
  message: string,
  retryable: boolean,
): AgentResult<MenuRecipesResult> {
  return { ok: false, error: { code, message, retryable } };
}

export async function runMenuRecipesAgent(
  input: MenuRecipesInput,
  provider: MenuRecipesProvider,
): Promise<AgentResult<MenuRecipesResult>> {
  let raw: MenuRecipesRaw;
  try {
    raw = await provider.generate(input);
  } catch (err) {
    if (err instanceof MenuRecipesConfigError) {
      return fail('AI_API_UNAVAILABLE', 'AI 推論が利用できません', false);
    }
    // MenuRecipesQuotaError は MenuRecipesRequestError の派生なので、先に判定する
    if (err instanceof MenuRecipesQuotaError) {
      return fail(
        'AI_QUOTA_EXCEEDED',
        '本日の AI 利用上限に達しました。時間をおいてお試しください。',
        false,
      );
    }
    if (err instanceof MenuRecipesRequestError) {
      return fail(
        'MENU_RECIPES_FAILED',
        'レシピの一括生成に失敗しました。もう一度お試しください。',
        true,
      );
    }
    return fail(
      'MENU_RECIPES_FAILED',
      err instanceof Error ? err.message : 'レシピの一括生成に失敗しました',
      true,
    );
  }

  const recipes = sanitizeMenuRecipeDrafts(raw.recipes, input.existingTitles, input.days);
  // 検証で全滅 → ok:false（空を AI の顔で返さない）
  if (recipes.length === 0) {
    return fail(
      'MENU_RECIPES_FAILED',
      'レシピの一括生成に失敗しました。もう一度お試しください。',
      true,
    );
  }

  return { ok: true, data: { recipes } };
}
