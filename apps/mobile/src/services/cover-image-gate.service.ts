/**
 * レシピ「イメージ」の AI 生成 — 別勘定のゲート（docs/レシピ表紙AI生成設計.md §3・
 * docs/フリーミアム設計.md §11・決定変更 G）。
 *
 * **既存の AI トークン（`usage.service.ts` の `ai_photo_recipe_token_balance`）とは
 * 完全に別**。1 枚 ≒¥5.0 はテキスト推論（¥0.35〜0.85）の 11〜17 倍で、同じ器で
 * 貯め合うと「安い方で貯めて高い方で使う」裁定が生まれる（設計 §3・決定変更 G）。
 *
 * - 無料: 月 3 枚（`app_meta` の端末ローカル月次カウント・**成功時のみ加算**）
 * - プレミアム: 月 10〜15 枚（`docs/フリーミアム設計.md` §11・広告は出さない）
 * - 枠切れ（無料のみ）→ 広告 1 本 = 1 枚・**即時消費・貯めない**
 *   （見た分だけその場で 1 回使える。月次カウンタは増やさない — 増やすと
 *   「広告を見たのに枠も減った」になる。銀行に積みもしない）
 * - BYOK: 無制限（利用者負担）
 */
import { getAdRewardProvider, isAdRewardAvailable } from './ad-reward.service';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { hasUserApiKey } from './byok.service';
import { dialog } from './dialog.service';
import { isPremium } from './entitlement.service';
import { currentMonthKey } from './usage.service';
import { t } from '../i18n';

/** 無料の月あたり枚数（設計 §3 確定）。 */
export const FREE_MONTHLY_COVER_LIMIT = 3;
/**
 * プレミアムの月あたり枚数。設計 §11「月 10〜15 枚から始める。実利用を見て増枠」
 * — 未確定の範囲の下寄りで始める（原価を保守的に見る）。
 */
export const PREMIUM_MONTHLY_COVER_LIMIT = 10;

const MONTHLY_COVER_USED_KEY_PREFIX = 'ai_cover_image_used:';

export interface CoverImageGateStatus {
  isPremium: boolean;
  isByok: boolean;
  used: number;
  /** Infinity for BYOK. */
  limit: number;
  /** Infinity for BYOK. */
  remaining: number;
  canGenerate: boolean;
  /** 広告を見ればこの場で 1 枚使えるか（無料のみ提示 — プレミアムには広告を出さない）。 */
  canWatchAdForMore: boolean;
}

export type CoverImageGateDecision = 'ready' | 'offer-ad' | 'paywall';

async function readMonthlyCoverUsed(key: string): Promise<number> {
  const raw = await getAppMeta(key);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** 今月、無料/プレミアムの枠をいくつ使ったか（端末ローカル時刻の暦月で区切る）。 */
export async function getMonthlyCoverUsed(date: Date = new Date()): Promise<number> {
  return readMonthlyCoverUsed(MONTHLY_COVER_USED_KEY_PREFIX + currentMonthKey(date));
}

/**
 * 純粋な状態計算（テスト対象）。BYOK は無制限、そうでなければプレミアム/無料で
 * 上限が変わる。広告は**無料が枠切れのときだけ**提示する（プレミアムは §11 で
 * 広告を出さないと決まっている）。
 */
export function deriveCoverImageGateStatus(
  premium: boolean,
  byok: boolean,
  used: number,
  adAvailable = false,
): CoverImageGateStatus {
  if (byok) {
    return {
      isPremium: premium,
      isByok: true,
      used: 0,
      limit: Number.POSITIVE_INFINITY,
      remaining: Number.POSITIVE_INFINITY,
      canGenerate: true,
      canWatchAdForMore: false,
    };
  }
  const limit = premium ? PREMIUM_MONTHLY_COVER_LIMIT : FREE_MONTHLY_COVER_LIMIT;
  const remaining = Math.max(0, limit - used);
  return {
    isPremium: premium,
    isByok: false,
    used,
    limit,
    remaining,
    canGenerate: remaining > 0,
    // プレミアムが枠切れのときは広告を出さない（§11「広告なし」がプレミアムの価値の一部）
    canWatchAdForMore: !premium && adAvailable && remaining === 0,
  };
}

/** 状態からの純粋な分岐（テスト対象。`inference-gate.service.ts` と同型）。 */
export function decideCoverImageGate(
  status: Pick<CoverImageGateStatus, 'canGenerate' | 'canWatchAdForMore'>,
): CoverImageGateDecision {
  if (status.canGenerate) return 'ready';
  if (status.canWatchAdForMore) return 'offer-ad';
  return 'paywall';
}

/** Combined premium + BYOK + quota status for the gate / UI. */
export async function getCoverImageGateStatus(
  date: Date = new Date(),
): Promise<CoverImageGateStatus> {
  const [premium, byok, used] = await Promise.all([
    isPremium(),
    hasUserApiKey(),
    getMonthlyCoverUsed(date),
  ]);
  return deriveCoverImageGateStatus(premium, byok, used, isAdRewardAvailable());
}

/**
 * 成功したイメージ生成を月次枠に対して数える。**成功時のみ・呼び出し側が呼ぶ**
 * （失敗・キャンセルでは数えない）。広告経由の 1 枚は数えない —
 * `ensureCoverImageCredit()` が返す `consumedAd: true` のときはここを呼ばないこと。
 */
export async function recordCoverImageUse(date: Date = new Date()): Promise<void> {
  const key = MONTHLY_COVER_USED_KEY_PREFIX + currentMonthKey(date);
  const next = (await readMonthlyCoverUsed(key)) + 1;
  await setAppMeta(key, String(next));
}

export interface EnsureCoverImageCreditResult {
  result: 'ready' | 'cancelled' | 'paywall';
  /**
   * true なら、この 1 回は広告視聴で得たぶん — **月次枠を減らさない**
   * （即時消費・貯めない。§3）。呼び出し側は生成成功後に `recordCoverImageUse()` を
   * 呼ばないこと。
   */
  consumedAd: boolean;
}

function confirmWatchAd(): Promise<boolean> {
  return dialog.confirm({
    title: t('coverImage.adGate.title'),
    message: t('coverImage.adGate.body'),
    confirmLabel: t('coverImage.adGate.watch'),
  });
}

/**
 * イメージ生成の直前に呼ぶ。'ready' ならそのまま `generateCoverImage()` を呼んでよい。
 * 'paywall' なら BYOK 案内（呼び出し側が遷移先を持つ）、'cancelled' は静かに戻す。
 */
export async function ensureCoverImageCredit(): Promise<EnsureCoverImageCreditResult> {
  const status = await getCoverImageGateStatus().catch(() => null);
  // 状態が読めないときは止めない（サーバー側の日次プールが最終防衛線）
  if (!status) return { result: 'ready', consumedAd: false };

  const decision = decideCoverImageGate(status);
  if (decision === 'ready') return { result: 'ready', consumedAd: false };
  if (decision === 'paywall') return { result: 'paywall', consumedAd: false };

  if (!(await confirmWatchAd())) return { result: 'cancelled', consumedAd: false };

  try {
    const { rewarded } = await getAdRewardProvider().showRewardedAd();
    if (!rewarded) return { result: 'cancelled', consumedAd: false }; // 途中で閉じた等
    return { result: 'ready', consumedAd: true };
  } catch {
    // no-fill・読み込み失敗。広告都合のエラーで詰まらせず、BYOK のあるペイウォールへ
    return { result: 'paywall', consumedAd: false };
  }
}
