import {
  getEntitlementProvider,
  isEntitlementConfigured,
  isPremium,
  resetEntitlementProviderForTesting,
  StubEntitlementProvider,
} from '../entitlement.service';
import { EntitlementUnavailableError, type EntitlementProvider } from '../entitlement.types';

describe('entitlement.service', () => {
  afterEach(() => {
    resetEntitlementProviderForTesting(null);
  });

  it('is not configured without a RevenueCat API key', () => {
    // No EXPO_PUBLIC_REVENUECAT_API_KEY is set under test.
    expect(isEntitlementConfigured()).toBe(false);
  });

  it('falls back to the stub provider when unconfigured', () => {
    expect(getEntitlementProvider()).toBeInstanceOf(StubEntitlementProvider);
  });

  describe('StubEntitlementProvider', () => {
    const stub = new StubEntitlementProvider();

    it('reports no premium and no offering', async () => {
      expect(await stub.isPremium()).toBe(false);
      expect(await stub.getOffering()).toBeNull();
      expect(await stub.restore()).toBe(false);
    });

    it('rejects purchases as unavailable', async () => {
      await expect(stub.purchasePremium()).rejects.toBeInstanceOf(EntitlementUnavailableError);
    });
  });

  describe('isPremium()', () => {
    it('returns false for the stub provider', async () => {
      expect(await isPremium()).toBe(false);
    });

    it('reflects an injected premium provider', async () => {
      const premiumProvider: EntitlementProvider = {
        configure: async () => undefined,
        isPremium: async () => true,
        getOffering: async () => null,
        purchasePremium: async () => ({ success: true }),
        restore: async () => true,
      };
      resetEntitlementProviderForTesting(premiumProvider);
      expect(await isPremium()).toBe(true);
    });

    it('swallows provider errors and returns false', async () => {
      const throwingProvider: EntitlementProvider = {
        configure: async () => undefined,
        isPremium: async () => {
          throw new Error('boom');
        },
        getOffering: async () => null,
        purchasePremium: async () => ({ success: false }),
        restore: async () => false,
      };
      resetEntitlementProviderForTesting(throwingProvider);
      expect(await isPremium()).toBe(false);
    });
  });
});
