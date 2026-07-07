/**
 * AdMob-backed rewarded-ad provider (native).
 *
 * The ONLY module that imports react-native-google-mobile-ads. Selected by the
 * factory in ad-reward.service.ts only when ADMOB_ENABLED on a native build; a
 * .web sibling keeps the SDK out of web bundles. Uses the official test ad unit
 * until EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID is set. See docs/フリーミアム設計.md §7.
 *
 * 同意管理（UMP）: 初期化前に AdsConsent.gatherConsent() で同意情報を更新し、
 * GDPR 対象地域では同意フォームを表示する（日本など対象外地域ではフォームは
 * 出ない）。広告のパーソナライズは UMP/TCF の同意状態に SDK が従うため、
 * requestNonPersonalizedAdsOnly は固定しない。
 */
import mobileAds, {
  AdEventType,
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

import { ADMOB_REWARDED_UNIT_ID } from '../config';
import {
  AdUnavailableError,
  type AdRewardProvider,
  type RewardedAdResult,
} from './ad-reward.types';

const UNIT_ID = ADMOB_REWARDED_UNIT_ID || TestIds.REWARDED;

export class AdMobRewardProvider implements AdRewardProvider {
  private initialized = false;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    try {
      // requestInfoUpdate ＋ 必要ならフォーム表示（EEA/UK のみ）を一括で行う
      await AdsConsent.gatherConsent();
    } catch {
      // ネットワーク不通等で同意情報を更新できなくても、前回の同意状態で
      // 広告を出せるか（canRequestAds）を下で確認する
    }
    const info = await AdsConsent.getConsentInfo();
    if (!info.canRequestAds) {
      throw new AdUnavailableError('広告の利用に必要な同意が確認できませんでした。');
    }
    await mobileAds().initialize();
    this.initialized = true;
  }

  isAvailable(): boolean {
    // The factory only returns this provider when AdMob is enabled; ads load on demand.
    return true;
  }

  async isPrivacyOptionsRequired(): Promise<boolean> {
    try {
      const info = await AdsConsent.getConsentInfo();
      return (
        info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED
      );
    } catch {
      return false;
    }
  }

  async showPrivacyOptionsForm(): Promise<void> {
    await AdsConsent.showPrivacyOptionsForm();
  }

  async showRewardedAd(): Promise<RewardedAdResult> {
    await this.ensureInitialized();
    return new Promise<RewardedAdResult>((resolve, reject) => {
      const ad = RewardedAd.createForAdRequest(UNIT_ID);
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
