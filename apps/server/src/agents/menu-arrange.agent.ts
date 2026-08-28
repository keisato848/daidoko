/**
 * MenuArrangeAgent — 献立候補を AI で飽きの来ない並びに組み替える。
 *
 * `RecipeConsultAgent` と同じ `AgentResult` 契約。違いは検証（`sanitizeMenuDays`）
 * を必ず通すこと——**AI 呼び出しが成功しても、検証で全滅したら ok:false を返す**
 * （`docs/買い物リスト・在庫設計.md` §10.10.1）。ok:true で空 days を返すと、
 * クライアントが `source:"ai"` として空を保存する事故につながる。
 */
import {
  MenuArrangeConfigError,
  MenuArrangeQuotaError,
  MenuArrangeRequestError,
  sanitizeMenuDays,
  type MenuArrangement,
  type MenuArrangeInput,
  type MenuArrangeProvider,
  type MenuArrangeRaw,
} from '../lib/menu-arrange.js';
import type { AgentErrorCode, AgentResult } from './photo-infer.agent.js';

function fail(
  code: AgentErrorCode,
  message: string,
  retryable: boolean,
): AgentResult<MenuArrangement> {
  return { ok: false, error: { code, message, retryable } };
}

function cleanNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

export async function runMenuArrangeAgent(
  input: MenuArrangeInput,
  candidateIds: ReadonlySet<string>,
  provider: MenuArrangeProvider,
): Promise<AgentResult<MenuArrangement>> {
  let raw: MenuArrangeRaw;
  try {
    raw = await provider.arrange(input);
  } catch (err) {
    if (err instanceof MenuArrangeConfigError) {
      return fail('AI_API_UNAVAILABLE', 'AI 推論が利用できません', false);
    }
    // MenuArrangeQuotaError は MenuArrangeRequestError の派生なので、先に判定する
    if (err instanceof MenuArrangeQuotaError) {
      return fail(
        'AI_QUOTA_EXCEEDED',
        '本日の AI 利用上限に達しました。時間をおいてお試しください。',
        false,
      );
    }
    if (err instanceof MenuArrangeRequestError) {
      return fail(
        'MENU_ARRANGE_FAILED',
        '献立の並べ替えに失敗しました。もう一度お試しください。',
        true,
      );
    }
    return fail(
      'MENU_ARRANGE_FAILED',
      err instanceof Error ? err.message : '献立の並べ替えに失敗しました',
      true,
    );
  }

  const days = sanitizeMenuDays(raw.days, candidateIds, input.days);
  // 検証で全滅 → ok:false（埋めない・空を AI の顔で返さない）
  if (days.length === 0) {
    return fail(
      'MENU_ARRANGE_FAILED',
      '献立の並べ替えに失敗しました。もう一度お試しください。',
      true,
    );
  }

  const note = cleanNote(raw.note);
  return { ok: true, data: { days, ...(note !== undefined && { note }) } };
}
