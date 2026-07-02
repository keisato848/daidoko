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

export interface AdRewardProvider {
  /** Whether rewarded ads are configured and can be shown. */
  isAvailable(): boolean;
  /** Show a rewarded ad; resolves rewarded:true only on full completion. */
  showRewardedAd(): Promise<RewardedAdResult>;
}

/** Thrown when a rewarded ad cannot be loaded/shown. */
export class AdUnavailableError extends Error {
  constructor(message = '広告を読み込めませんでした。時間をおいてお試しください。') {
    super(message);
    this.name = 'AdUnavailableError';
  }
}
