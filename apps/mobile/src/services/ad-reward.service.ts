/**
 * Rewarded-ad service — selects the ad provider for the freemium "watch an ad
 * for one more" path. Defaults to a stub that disables all ad UI; wiring AdMob
 * activates real rewarded ads. See docs/フリーミアム設計.md.
 */
import type { AdRewardProvider, RewardedAdResult } from './ad-reward.types';

/** Fallback provider: no ads available (default until AdMob is wired). */
export class StubAdRewardProvider implements AdRewardProvider {
  isAvailable(): boolean {
    return false;
  }
  async showRewardedAd(): Promise<RewardedAdResult> {
    return { rewarded: false };
  }
}

let cachedProvider: AdRewardProvider | null = null;

export function getAdRewardProvider(): AdRewardProvider {
  // To enable real ads: install react-native-google-mobile-ads, add the config
  // plugin + your AdMob IDs, drop in the AdMobRewardProvider from
  // docs/フリーミアム設計.md, and return it here (guarded by an env flag). Until
  // then the stub keeps every ad affordance hidden and the app unchanged.
  if (!cachedProvider) cachedProvider = new StubAdRewardProvider();
  return cachedProvider;
}

/** Test-only: swap the memoized provider. */
export function resetAdRewardProviderForTesting(provider: AdRewardProvider | null): void {
  cachedProvider = provider;
}

/** Whether rewarded ads can be shown right now (never throws). */
export function isAdRewardAvailable(): boolean {
  try {
    return getAdRewardProvider().isAvailable();
  } catch {
    return false;
  }
}
