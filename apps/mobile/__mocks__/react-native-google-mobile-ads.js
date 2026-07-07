/* global jest */
/**
 * Manual Jest mock for react-native-google-mobile-ads — keeps the native ad SDK
 * out of unit tests. ad-reward.service imports ad-reward.admob (which imports
 * this package); the AdMob provider is only instantiated when ADMOB_ENABLED, so
 * this only needs to be import-safe. Ad-flow tests inject a fake provider via
 * resetAdRewardProviderForTesting.
 */
// 単一インスタンスを返す（テストから initialize の呼び出しを観測できるように）
const adsInstance = { initialize: jest.fn(async () => []) };
const mobileAds = () => adsInstance;

const RewardedAd = {
  createForAdRequest: jest.fn(() => ({
    addAdEventListener: jest.fn(() => jest.fn()),
    load: jest.fn(),
    show: jest.fn(async () => undefined),
  })),
};

const AdsConsent = {
  gatherConsent: jest.fn(async () => ({
    canRequestAds: true,
    privacyOptionsRequirementStatus: 'NOT_REQUIRED',
  })),
  getConsentInfo: jest.fn(async () => ({
    canRequestAds: true,
    privacyOptionsRequirementStatus: 'NOT_REQUIRED',
  })),
  showPrivacyOptionsForm: jest.fn(async () => ({
    canRequestAds: true,
    privacyOptionsRequirementStatus: 'REQUIRED',
  })),
  reset: jest.fn(),
};

module.exports = {
  __esModule: true,
  default: mobileAds,
  AdEventType: { CLOSED: 'closed', ERROR: 'error' },
  RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'rewarded_earned_reward' },
  TestIds: { REWARDED: 'ca-app-pub-3940256099942544/5224354917' },
  RewardedAd,
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus: {
    NOT_REQUIRED: 'NOT_REQUIRED',
    REQUIRED: 'REQUIRED',
    UNKNOWN: 'UNKNOWN',
  },
};
