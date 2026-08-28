/**
 * CoverImageAgent — レシピの「イメージ」を AI で生成する
 * （docs/レシピ表紙AI生成設計.md）。
 *
 * `MenuArrangeAgent`/`RecipeConsultAgent` と同じ `AgentResult` 契約 — 常に 200・
 * エラーはボディに載る（route の呼び出し側が判断を分岐しやすくするため）。
 * こちらは検証で「捨てる」ような後処理が無い（画像は生データをそのまま運ぶだけ）
 * ので、provider の成否がそのまま結果になる。
 */
import {
  CoverImageConfigError,
  CoverImageQuotaError,
  CoverImageRequestError,
  type CoverImageInput,
  type CoverImageProvider,
  type CoverImageResult,
} from '../lib/cover-image.js';
import type { AgentErrorCode, AgentResult } from './photo-infer.agent.js';

function fail(
  code: AgentErrorCode,
  message: string,
  retryable: boolean,
): AgentResult<CoverImageResult> {
  return { ok: false, error: { code, message, retryable } };
}

export async function runCoverImageAgent(
  input: CoverImageInput,
  provider: CoverImageProvider,
): Promise<AgentResult<CoverImageResult>> {
  try {
    const data = await provider.generate(input);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof CoverImageConfigError) {
      return fail('AI_API_UNAVAILABLE', 'AI 推論が利用できません', false);
    }
    // CoverImageQuotaError は CoverImageRequestError の派生なので、先に判定する
    if (err instanceof CoverImageQuotaError) {
      return fail(
        'AI_QUOTA_EXCEEDED',
        '本日の AI 利用上限に達しました。時間をおいてお試しください。',
        false,
      );
    }
    if (err instanceof CoverImageRequestError) {
      return fail(
        'COVER_IMAGE_FAILED',
        'イメージの生成に失敗しました。もう一度お試しください。',
        true,
      );
    }
    return fail(
      'COVER_IMAGE_FAILED',
      err instanceof Error ? err.message : 'イメージの生成に失敗しました',
      true,
    );
  }
}
