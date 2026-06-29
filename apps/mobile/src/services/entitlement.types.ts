/**
 * Entitlement (premium membership) provider abstraction.
 *
 * The concrete provider is RevenueCat in production and a stub in tests / web /
 * unconfigured builds. Premium is the only paid tier; the free tier needs no
 * provider call (it is gated by the device-local monthly quota — see
 * usage.service.ts and docs/フリーミアム設計.md).
 */

/** RevenueCat entitlement identifier that unlocks unlimited AI photo-recipes. */
export const PREMIUM_ENTITLEMENT_ID = 'premium';

/** Display-only info for the paywall (price comes from the store). */
export interface PremiumOffering {
  priceString: string;
  productId: string;
}

export interface PurchaseOutcome {
  success: boolean;
  /** true when the user dismissed the store dialog — not an error. */
  cancelled?: boolean;
}

export interface EntitlementProvider {
  /** Idempotent SDK init. Safe to call before any other method. */
  configure(): Promise<void>;
  isPremium(): Promise<boolean>;
  /** The premium offering for display, or null when none is available. */
  getOffering(): Promise<PremiumOffering | null>;
  /** Run the store purchase flow. cancelled:true when the user backs out. */
  purchasePremium(): Promise<PurchaseOutcome>;
  /** Restore prior purchases; returns whether premium is now active. */
  restore(): Promise<boolean>;
}

/** Thrown when premium cannot be offered (e.g. RevenueCat not configured). */
export class EntitlementUnavailableError extends Error {
  constructor(message = 'プレミアムは現在ご利用いただけません') {
    super(message);
    this.name = 'EntitlementUnavailableError';
  }
}
