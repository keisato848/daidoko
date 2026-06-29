import {
  getAdRewardProvider,
  isAdRewardAvailable,
  resetAdRewardProviderForTesting,
  StubAdRewardProvider,
} from '../ad-reward.service';
import type { AdRewardProvider } from '../ad-reward.types';

describe('ad-reward.service', () => {
  afterEach(() => {
    resetAdRewardProviderForTesting(null);
  });

  it('defaults to the stub provider (ads disabled)', () => {
    expect(getAdRewardProvider()).toBeInstanceOf(StubAdRewardProvider);
    expect(isAdRewardAvailable()).toBe(false);
  });

  describe('StubAdRewardProvider', () => {
    const stub = new StubAdRewardProvider();

    it('is unavailable and never rewards', async () => {
      expect(stub.isAvailable()).toBe(false);
      expect(await stub.showRewardedAd()).toEqual({ rewarded: false });
    });
  });

  it('reflects an injected available provider', async () => {
    const provider: AdRewardProvider = {
      isAvailable: () => true,
      showRewardedAd: async () => ({ rewarded: true }),
    };
    resetAdRewardProviderForTesting(provider);
    expect(isAdRewardAvailable()).toBe(true);
    expect(await getAdRewardProvider().showRewardedAd()).toEqual({ rewarded: true });
  });

  it('isAdRewardAvailable swallows provider errors', () => {
    const provider: AdRewardProvider = {
      isAvailable: () => {
        throw new Error('boom');
      },
      showRewardedAd: async () => ({ rewarded: false }),
    };
    resetAdRewardProviderForTesting(provider);
    expect(isAdRewardAvailable()).toBe(false);
  });
});
