/**
 * Web has no AdMob — this sibling keeps react-native-google-mobile-ads out of
 * web bundles. Metro resolves this for web; ad-reward.admob.ts is used natively.
 */
import type { AdRewardProvider, RewardedAdResult } from './ad-reward.types';

export class AdMobRewardProvider implements AdRewardProvider {
  isAvailable(): boolean {
    return false;
  }
  async showRewardedAd(): Promise<RewardedAdResult> {
    return { rewarded: false };
  }
}
