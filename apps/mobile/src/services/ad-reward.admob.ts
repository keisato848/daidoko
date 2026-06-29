/**
 * AdMob-backed rewarded-ad provider (native).
 *
 * The ONLY module that imports react-native-google-mobile-ads. Selected by the
 * factory in ad-reward.service.ts only when ADMOB_ENABLED on a native build; a
 * .web sibling keeps the SDK out of web bundles. Uses the official test ad unit
 * until EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID is set. See docs/フリーミアム設計.md §7.
 */
import mobileAds, {
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

import { ADMOB_REWARDED_UNIT_ID } from '../config';
import type { AdRewardProvider, RewardedAdResult } from './ad-reward.types';

const UNIT_ID = ADMOB_REWARDED_UNIT_ID || TestIds.REWARDED;

export class AdMobRewardProvider implements AdRewardProvider {
  private initialized = false;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await mobileAds().initialize();
    this.initialized = true;
  }

  isAvailable(): boolean {
    // The factory only returns this provider when AdMob is enabled; ads load on demand.
    return true;
  }

  async showRewardedAd(): Promise<RewardedAdResult> {
    await this.ensureInitialized();
    return new Promise<RewardedAdResult>((resolve, reject) => {
      const ad = RewardedAd.createForAdRequest(UNIT_ID, {
        requestNonPersonalizedAdsOnly: true,
      });
      let earned = false;
      const cleanups: Array<() => void> = [];
      const cleanup = (): void => cleanups.forEach((off) => off());

      cleanups.push(
        ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
          ad.show().catch((error: unknown) => {
            cleanup();
            reject(error instanceof Error ? error : new Error('広告を表示できませんでした'));
          });
        }),
      );
      cleanups.push(
        ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
          earned = true;
        }),
      );
      cleanups.push(
        ad.addAdEventListener(AdEventType.CLOSED, () => {
          cleanup();
          resolve({ rewarded: earned });
        }),
      );
      cleanups.push(
        ad.addAdEventListener(AdEventType.ERROR, (error: unknown) => {
          cleanup();
          reject(error instanceof Error ? error : new Error('広告の読み込みに失敗しました'));
        }),
      );

      ad.load();
    });
  }
}
