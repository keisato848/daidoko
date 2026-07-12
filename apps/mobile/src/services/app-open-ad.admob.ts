/**
 * AdMob-backed App Open ad provider (native).
 *
 * ad-reward.admob.ts と並ぶ、react-native-google-mobile-ads を import してよい
 * 2 つのモジュールのうちの 1 つ。web バンドルには .web 兄弟ファイルが選ばれる。
 * EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID 未設定時は公式テストユニットを使う。
 *
 * 同意管理（UMP）はリワード側と同じ方針: 表示前に gatherConsent → canRequestAds
 * を確認し、確認できなければ黙って出さない（起動広告はベストエフォート）。
 */
import mobileAds, {
  AdEventType,
  AdsConsent,
  AppOpenAd,
  TestIds,
} from 'react-native-google-mobile-ads';

import { ADMOB_APP_OPEN_UNIT_ID } from '../config';
import type { AppOpenAdProvider } from './app-open-ad.types';

const UNIT_ID = ADMOB_APP_OPEN_UNIT_ID || TestIds.APP_OPEN;

// AdMob の App Open 広告は読み込みから 4 時間で失効する。余裕を見て 3.5h。
const AD_TTL_MS = 3.5 * 60 * 60 * 1000;

export class AdMobAppOpenAdProvider implements AppOpenAdProvider {
  private initialized = false;
  private ad: AppOpenAd | null = null;
  private loadedAt = 0;
  private loading = false;

  private async ensureInitialized(): Promise<boolean> {
    if (this.initialized) return true;
    try {
      await AdsConsent.gatherConsent();
    } catch {
      // ネットワーク不通等 — 前回の同意状態で判断する
    }
    try {
      const info = await AdsConsent.getConsentInfo();
      if (!info.canRequestAds) return false;
      await mobileAds().initialize();
      this.initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  preload(): void {
    if (this.loading || this.isLoaded()) return;
    this.loading = true;
    void this.ensureInitialized().then((ok) => {
      if (!ok) {
        this.loading = false;
        return;
      }
      const ad = AppOpenAd.createForAdRequest(UNIT_ID);
      const offLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
        this.ad = ad;
        this.loadedAt = Date.now();
        this.loading = false;
        offLoaded();
        offError();
      });
      const offError = ad.addAdEventListener(AdEventType.ERROR, () => {
        this.loading = false;
        offLoaded();
        offError();
      });
      ad.load();
    });
  }

  isLoaded(): boolean {
    return this.ad !== null && Date.now() - this.loadedAt < AD_TTL_MS;
  }

  async show(): Promise<boolean> {
    const ad = this.ad;
    if (!ad || !this.isLoaded()) return false;
    this.ad = null; // 1 枚 1 回。次の分は表示後に preload し直す
    return new Promise<boolean>((resolve) => {
      const cleanups: Array<() => void> = [];
      const cleanup = (): void => cleanups.forEach((off) => off());
      cleanups.push(
        ad.addAdEventListener(AdEventType.CLOSED, () => {
          cleanup();
          resolve(true);
        }),
      );
      cleanups.push(
        ad.addAdEventListener(AdEventType.ERROR, () => {
          cleanup();
          resolve(false);
        }),
      );
      ad.show().catch(() => {
        cleanup();
        resolve(false);
      });
    });
  }
}
