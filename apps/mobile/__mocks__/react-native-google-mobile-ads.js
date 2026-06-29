/* global jest */
/**
 * Manual Jest mock for react-native-google-mobile-ads — keeps the native ad SDK
 * out of unit tests. ad-reward.service imports ad-reward.admob (which imports
 * this package); the AdMob provider is only instantiated when ADMOB_ENABLED, so
 * this only needs to be import-safe. Ad-flow tests inject a fake provider via
 * resetAdRewardProviderForTesting.
 */
const mobileAds = () => ({ initialize: jest.fn(async () => []) });

const RewardedAd = {
  createForAdRequest: jest.fn(() => ({
    addAdEventListener: jest.fn(() => jest.fn()),
    load: jest.fn(),
    show: jest.fn(async () => undefined),
  })),
};

module.exports = {
  __esModule: true,
  default: mobileAds,
  AdEventType: { CLOSED: 'closed', ERROR: 'error' },
  RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'rewarded_earned_reward' },
  TestIds: { REWARDED: 'ca-app-pub-3940256099942544/5224354917' },
  RewardedAd,
};
