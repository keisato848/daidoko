/**
 * AdMobRewardProvider — UMP 同意フローとリワード広告の結線を検証する。
 * react-native-google-mobile-ads は __mocks__ の手動モック（自動適用）。
 */
import mobileAds, { AdsConsent, RewardedAd } from 'react-native-google-mobile-ads';

import { AdMobRewardProvider } from '../ad-reward.admob';
import { AdUnavailableError } from '../ad-reward.types';

const mockGatherConsent = AdsConsent.gatherConsent as jest.Mock;
const mockGetConsentInfo = AdsConsent.getConsentInfo as jest.Mock;
const mockShowPrivacyOptionsForm = AdsConsent.showPrivacyOptionsForm as jest.Mock;
const mockCreateForAdRequest = RewardedAd.createForAdRequest as jest.Mock;
const mockInitialize = mobileAds().initialize as jest.Mock;

interface FakeAd {
  addAdEventListener: jest.Mock;
  load: jest.Mock;
  show: jest.Mock;
}

/** LOADED→show→EARNED_REWARD→CLOSED まで自走する広告のフェイク。 */
function makeFakeAd({ earnReward = true } = {}): FakeAd {
  const listeners: Record<string, (arg?: unknown) => void> = {};
  const ad: FakeAd = {
    addAdEventListener: jest.fn((type: string, cb: (arg?: unknown) => void) => {
      listeners[type] = cb;
      return () => {};
    }),
    load: jest.fn(() => {
      listeners['rewarded_loaded']?.();
    }),
    show: jest.fn(async () => {
      if (earnReward) listeners['rewarded_earned_reward']?.();
      listeners['closed']?.();
    }),
  };
  return ad;
}

function consentInfo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    canRequestAds: true,
    privacyOptionsRequirementStatus: 'NOT_REQUIRED',
    ...overrides,
  };
}

describe('AdMobRewardProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGatherConsent.mockResolvedValue(consentInfo());
    mockGetConsentInfo.mockResolvedValue(consentInfo());
  });

  it('gathers UMP consent before initializing and rewards on full watch', async () => {
    mockCreateForAdRequest.mockReturnValue(makeFakeAd({ earnReward: true }));

    const provider = new AdMobRewardProvider();
    const result = await provider.showRewardedAd();

    expect(result).toEqual({ rewarded: true });
    expect(mockGatherConsent).toHaveBeenCalled();
    // 同意フロー → SDK 初期化 の順序
    expect(mockGatherConsent.mock.invocationCallOrder[0]).toBeLessThan(
      mockInitialize.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('resolves rewarded:false when the ad is closed early', async () => {
    mockCreateForAdRequest.mockReturnValue(makeFakeAd({ earnReward: false }));

    const provider = new AdMobRewardProvider();
    await expect(provider.showRewardedAd()).resolves.toEqual({ rewarded: false });
  });

  it('throws AdUnavailableError when ads cannot be requested (no consent)', async () => {
    mockGatherConsent.mockResolvedValue(consentInfo({ canRequestAds: false }));
    mockGetConsentInfo.mockResolvedValue(consentInfo({ canRequestAds: false }));

    const provider = new AdMobRewardProvider();
    await expect(provider.showRewardedAd()).rejects.toBeInstanceOf(AdUnavailableError);
    expect(mockCreateForAdRequest).not.toHaveBeenCalled();
  });

  it('falls back to the previous consent state when gatherConsent fails', async () => {
    mockGatherConsent.mockRejectedValue(new Error('network'));
    mockGetConsentInfo.mockResolvedValue(consentInfo({ canRequestAds: true }));
    mockCreateForAdRequest.mockReturnValue(makeFakeAd());

    const provider = new AdMobRewardProvider();
    await expect(provider.showRewardedAd()).resolves.toEqual({ rewarded: true });
  });

  it('reports privacy options requirement only when REQUIRED', async () => {
    const provider = new AdMobRewardProvider();

    mockGetConsentInfo.mockResolvedValue(
      consentInfo({ privacyOptionsRequirementStatus: 'REQUIRED' }),
    );
    await expect(provider.isPrivacyOptionsRequired()).resolves.toBe(true);

    mockGetConsentInfo.mockResolvedValue(
      consentInfo({ privacyOptionsRequirementStatus: 'NOT_REQUIRED' }),
    );
    await expect(provider.isPrivacyOptionsRequired()).resolves.toBe(false);

    mockGetConsentInfo.mockRejectedValue(new Error('boom'));
    await expect(provider.isPrivacyOptionsRequired()).resolves.toBe(false);
  });

  it('delegates the privacy options form to the SDK', async () => {
    const provider = new AdMobRewardProvider();
    await provider.showPrivacyOptionsForm();
    expect(mockShowPrivacyOptionsForm).toHaveBeenCalled();
  });
});
