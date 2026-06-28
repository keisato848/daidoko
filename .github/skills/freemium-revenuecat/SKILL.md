---
name: freemium-revenuecat
description: 'Use when changing the AI photo-recipe freemium model — the free monthly quota, premium entitlement, paywall, or the RevenueCat integration boundary.'
user-invocable: true
argument-hint: 'Provide what is changing (free limit, price, entitlement id, or store config)'
---

# Freemium / RevenueCat Wiring

Design of record: `docs/フリーミアム設計.md`.

## When To Use

- Adjusting the free tier limit, premium price/plan, or paywall copy.
- Wiring or debugging the RevenueCat entitlement integration.

## Where Things Live (apps/mobile)

- `src/services/usage.service.ts` — device-local monthly quota (`FREE_MONTHLY_LIMIT = 3`,
  `app_meta` key `ai_photo_recipe_usage:YYYY-MM`, auto-resets monthly). `getFreemiumStatus()`,
  `recordCloudInference()`.
- `src/services/entitlement.service.ts` — provider factory (RevenueCat when
  `EXPO_PUBLIC_REVENUECAT_API_KEY` set + native, else `StubEntitlementProvider`).
- `src/services/entitlement.revenuecat.ts` — the ONLY file importing `react-native-purchases`.
- `app/(tabs)/recipes/paywall.tsx` — subscribe + restore UI.
- `app/(tabs)/recipes/import-photo.tsx` — the gate (blocks at `canInfer === false`, shows remaining).
- `app/(tabs)/settings.tsx` — プラン section.

## Rules

- Count a free use **only** when the agent returns `source: 'cloud'` (a successful paid
  inference). not-a-dish errors and on-device fallback must NOT consume the quota.
- The server cannot enforce per-user limits (no auth) — keep that gate client-side; the server
  caps are cost/abuse guards only.
- Tests never load the native SDK (Jest manual mock at `apps/mobile/__mocks__/react-native-purchases.js`);
  premium flows inject a fake via `resetEntitlementProviderForTesting`.

## Operator Boundary (store-side, not code)

1. RevenueCat account → project → public API key → build with `EXPO_PUBLIC_REVENUECAT_API_KEY`.
2. RevenueCat entitlement id **`premium`** + an Offering containing a monthly package.
3. Play Console / App Store Connect monthly subscription product, linked in RevenueCat.
4. Verify the real purchase in a dev/release build with a sandbox/test account (native link is
   unverified by JS gates).

## Constraints

- Do not import `react-native-purchases` outside `entitlement.revenuecat.ts`.
- Keep the app fully functional on the free tier when no API key is set (stub provider).
