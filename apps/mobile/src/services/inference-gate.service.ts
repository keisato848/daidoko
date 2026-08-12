/**
 * AI 推論の入口ゲート（2026-08-12）。
 *
 * それまでは「枠切れ → ペイウォール画面へ遷移」だった。課金（プレミアム）が
 * まだ存在しない現状では、毎回ペイウォールを経由させる意味がない —
 * **枠切れなら、その場で広告視聴を持ちかけて、見終わったらそのまま続行**する。
 *
 * リワード広告は**利用者が選んで見る**形式（AdMob ポリシー）なので、
 * 自動再生はせず、確認ダイアログを 1 つだけ挟む。
 *
 * ペイウォール画面は「広告が出せないとき」（視聴上限・no-fill・広告無効ビルド）の
 * 逃げ道として残す — BYOK の案内がそこにある。
 */
import { Alert } from 'react-native';

import { getAdRewardProvider } from './ad-reward.service';
import { grantAdBonus, getFreemiumStatus, type FreemiumStatus } from './usage.service';
import { t } from '../i18n';

export type InferenceGateDecision = 'ready' | 'offer-ad' | 'paywall';
export type InferenceGateResult = 'ready' | 'cancelled' | 'paywall';

/**
 * 状態からの純粋な分岐（テスト対象）。
 * - canInfer → そのまま実行
 * - 枠切れ ＋ 広告を出せる → その場で広告を持ちかける
 * - 枠切れ ＋ 広告を出せない（視聴上限・広告なしビルド）→ ペイウォール（BYOK 案内）
 */
export function decideInferenceGate(
  status: Pick<FreemiumStatus, 'canInfer' | 'canWatchAdForMore'>,
): InferenceGateDecision {
  if (status.canInfer) return 'ready';
  if (status.canWatchAdForMore) return 'offer-ad';
  return 'paywall';
}

function confirmWatchAd(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(t('ai.adGate.title'), t('ai.adGate.body'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: t('ai.adGate.watch'), onPress: () => resolve(true) },
    ]);
  });
}

/**
 * AI を使う直前に呼ぶ。'ready' ならそのまま実行してよい。
 * 'paywall' なら呼び出し側がペイウォールへ遷移する（router は画面が持っているため）。
 */
export async function ensureInferenceCredit(): Promise<InferenceGateResult> {
  const status = await getFreemiumStatus().catch(() => null);
  // 状態が読めないときは止めない（サーバー側の上限が最終防衛線）
  if (!status) return 'ready';

  const decision = decideInferenceGate(status);
  if (decision === 'ready') return 'ready';
  if (decision === 'paywall') return 'paywall';

  if (!(await confirmWatchAd())) return 'cancelled';

  try {
    const { rewarded } = await getAdRewardProvider().showRewardedAd();
    if (!rewarded) return 'cancelled'; // 途中で閉じた等。静かに戻す
    await grantAdBonus();
    return 'ready';
  } catch {
    // no-fill・読み込み失敗。広告都合のエラーで詰まらせず、BYOK のあるペイウォールへ
    return 'paywall';
  }
}
