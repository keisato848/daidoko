/**
 * RevenueCat-backed entitlement provider.
 *
 * This is the ONLY module that imports react-native-purchases. It is selected by
 * the factory in entitlement.service.ts only on a native build with
 * EXPO_PUBLIC_REVENUECAT_API_KEY set; otherwise the stub is used and these code
 * paths never run. Premium state is the store receipt (validated by RevenueCat),
 * so it cannot be spoofed by the device-local free-quota store.
 */
import Purchases, {
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';

import { REVENUECAT_API_KEY } from '../config';
import {
  EntitlementUnavailableError,
  PREMIUM_ENTITLEMENT_ID,
  type EntitlementProvider,
  type PremiumOffering,
  type PurchaseOutcome,
} from './entitlement.types';

function hasPremium(info: CustomerInfo): boolean {
  return info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
}

export class RevenueCatEntitlementProvider implements EntitlementProvider {
  private configured = false;
  private cachedPackage: PurchasesPackage | null = null;

  async configure(): Promise<void> {
    if (this.configured) return;
    if (!REVENUECAT_API_KEY) throw new EntitlementUnavailableError();
    Purchases.configure({ apiKey: REVENUECAT_API_KEY });
    this.configured = true;
  }

  async isPremium(): Promise<boolean> {
    await this.configure();
    return hasPremium(await Purchases.getCustomerInfo());
  }

  private async loadCurrentPackage(): Promise<PurchasesPackage | null> {
    await this.configure();
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.monthly ?? offerings.current?.availablePackages[0] ?? null;
    this.cachedPackage = pkg;
    return pkg;
  }

  async getOffering(): Promise<PremiumOffering | null> {
    const pkg = await this.loadCurrentPackage();
    if (!pkg) return null;
    return { priceString: pkg.product.priceString, productId: pkg.product.identifier };
  }

  async purchasePremium(): Promise<PurchaseOutcome> {
    const pkg = this.cachedPackage ?? (await this.loadCurrentPackage());
    if (!pkg) throw new EntitlementUnavailableError('購入できる商品が見つかりませんでした');
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      return { success: hasPremium(customerInfo) };
    } catch (error) {
      if ((error as { userCancelled?: boolean }).userCancelled) {
        return { success: false, cancelled: true };
      }
      throw error;
    }
  }

  async restore(): Promise<boolean> {
    await this.configure();
    return hasPremium(await Purchases.restorePurchases());
  }
}
