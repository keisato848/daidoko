import { t } from '../i18n';
/**
 * Rewarded-ad provider abstraction.
 *
 * A free user who has used their daily quota can watch a rewarded ad to earn one
 * extra AI photo-recipe (capped per day — see usage.service.ts). The concrete
 * provider is AdMob in production and a stub elsewhere; the stub reports
 * unavailable so no ad UI is shown until AdMob is wired (see
 * docs/フリーミアム設計.md).
 */

export interface RewardedAdResult {
  /** true only when the user watched to completion and earned the reward. */
  rewarded: boolean;
}

/**
 * ロード済みのリワード広告。**画面はロードに成功したときだけ広告ボタンを出す**。
 *
 * 旧来はタップしてから load() していたため、在庫が無い（no-fill — 公開直後の
 * iOS はほぼ確実）と「押すと必ずエラーになるボタン」が出ていた。App Review に
 * Guideline 2.1 で却下された実例あり（2026-08-21・iPad）。押せないボタンを
 * 出さないため、ロードと表示を分離する。
 */
export interface PreparedRewardedAd {
  /** Show the loaded ad; resolves rewarded:true only on full completion. */
  show(): Promise<RewardedAdResult>;
}

export interface AdRewardProvider {
  /** Whether rewarded ads are configured and can be shown. */
  isAvailable(): boolean;
  /**
   * Load a rewarded ad ahead of time. Rejects (AdUnavailableError) on no-fill
   * or timeout — the screen then simply doesn't render the ad button.
   */
  loadRewardedAd(): Promise<PreparedRewardedAd>;
  /** Load + show in one go (kept for tests / simple callers). */
  showRewardedAd(): Promise<RewardedAdResult>;
  /**
   * Whether the UMP privacy-options form must be offered to this user
   * (GDPR 対象地域のみ true — 設定画面に「広告のプライバシー設定」を出す判定)。
   */
  isPrivacyOptionsRequired(): Promise<boolean>;
  /** Show the UMP privacy-options form so the user can change ad consent. */
  showPrivacyOptionsForm(): Promise<void>;
}

/** Thrown when a rewarded ad cannot be loaded/shown. */
export class AdUnavailableError extends Error {
  constructor(message = t('ads.loadFailed')) {
    super(message);
    this.name = 'AdUnavailableError';
  }
}
