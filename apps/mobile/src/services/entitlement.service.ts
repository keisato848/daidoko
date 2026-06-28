/**
 * Entitlement service — premium membership state for the freemium model.
 *
 * Picks the RevenueCat provider on a configured native build, else a stub that
 * keeps the app fully usable on the free tier (web, tests, or no API key).
 * See docs/フリーミアム設計.md.
 */
import { Platform } from 'react-native';

import { REVENUECAT_API_KEY } from '../config';
import { RevenueCatEntitlementProvider } from './entitlement.revenuecat';
import {
  EntitlementUnavailableError,
  type EntitlementProvider,
  type PremiumOffering,
  type PurchaseOutcome,
} from './entitlement.types';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

/** Fallback provider: free tier only, purchases unavailable. */
export class StubEntitlementProvider implements EntitlementProvider {
  async configure(): Promise<void> {
    // no-op
  }
  async isPremium(): Promise<boolean> {
    return false;
  }
  async getOffering(): Promise<PremiumOffering | null> {
    return null;
  }
  async purchasePremium(): Promise<PurchaseOutcome> {
    throw new EntitlementUnavailableError(
      'プレミアムはまだご利用いただけません。アプリの更新をお待ちください。',
    );
  }
  async restore(): Promise<boolean> {
    return false;
  }
}

let cachedProvider: EntitlementProvider | null = null;

/** Whether a real (RevenueCat) entitlement provider is active. */
export function isEntitlementConfigured(): boolean {
  return isNative && REVENUECAT_API_KEY.length > 0;
}

export function getEntitlementProvider(): EntitlementProvider {
  if (!cachedProvider) {
    cachedProvider = isEntitlementConfigured()
      ? new RevenueCatEntitlementProvider()
      : new StubEntitlementProvider();
  }
  return cachedProvider;
}

/** Test-only: reset the memoized provider. */
export function resetEntitlementProviderForTesting(provider: EntitlementProvider | null): void {
  cachedProvider = provider;
}

/** Premium check that never throws (false on any error). */
export async function isPremium(): Promise<boolean> {
  try {
    return await getEntitlementProvider().isPremium();
  } catch {
    return false;
  }
}
