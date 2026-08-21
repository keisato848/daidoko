/**
 * Web has no AdMob — this sibling keeps react-native-google-mobile-ads out of
 * web bundles. Metro resolves this for web; ad-reward.admob.ts is used natively.
 */
import {
  AdUnavailableError,
  type AdRewardProvider,
  type PreparedRewardedAd,
  type RewardedAdResult,
} from './ad-reward.types';

export class AdMobRewardProvider implements AdRewardProvider {
  isAvailable(): boolean {
    return false;
  }
  async loadRewardedAd(): Promise<PreparedRewardedAd> {
    throw new AdUnavailableError();
  }
  async showRewardedAd(): Promise<RewardedAdResult> {
    return { rewarded: false };
  }
  async isPrivacyOptionsRequired(): Promise<boolean> {
    return false;
  }
  async showPrivacyOptionsForm(): Promise<void> {
    // no-op — web has no ads and therefore no consent UI
  }
}
