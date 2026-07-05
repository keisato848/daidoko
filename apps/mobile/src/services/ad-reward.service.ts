/**
 * Rewarded-ad service — selects the ad provider for the freemium "watch an ad
 * for one more" path. Defaults to a stub that disables all ad UI; wiring AdMob
 * activates real rewarded ads. See docs/フリーミアム設計.md.
 */
import { Platform } from 'react-native';

import { AdMobRewardProvider } from './ad-reward.admob';
import { ADMOB_ENABLED } from '../config';
import type { AdRewardProvider, RewardedAdResult } from './ad-reward.types';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

/** Fallback provider: no ads available (used when AdMob is disabled). */
export class StubAdRewardProvider implements AdRewardProvider {
  isAvailable(): boolean {
    return false;
  }
  async showRewardedAd(): Promise<RewardedAdResult> {
    return { rewarded: false };
  }
  async isPrivacyOptionsRequired(): Promise<boolean> {
    return false;
  }
  async showPrivacyOptionsForm(): Promise<void> {
    // no-op — no ads means no consent UI
  }
}

let cachedProvider: AdRewardProvider | null = null;

/** Whether real AdMob rewarded ads are wired (env flag + native). */
export function isAdRewardConfigured(): boolean {
  return isNative && ADMOB_ENABLED;
}

export function getAdRewardProvider(): AdRewardProvider {
  // AdMob is selected only when EXPO_PUBLIC_ADMOB_ENABLED=true on a native build;
  // otherwise the stub keeps every ad affordance hidden and the app unchanged.
  if (!cachedProvider) {
    cachedProvider = isAdRewardConfigured()
      ? new AdMobRewardProvider()
      : new StubAdRewardProvider();
  }
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
