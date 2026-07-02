/* global jest */
/**
 * Manual Jest mock for react-native-purchases.
 *
 * Keeps the native SDK out of unit tests (importing entitlement.service pulls in
 * entitlement.revenuecat, which imports this package). Tests that exercise
 * premium flows inject their own provider via resetEntitlementProviderForTesting
 * rather than relying on this mock, so it only needs to be import-safe.
 */
const noPremiumCustomerInfo = { entitlements: { active: {} } };

const Purchases = {
  configure: jest.fn(),
  setLogLevel: jest.fn(),
  getCustomerInfo: jest.fn(async () => noPremiumCustomerInfo),
  getOfferings: jest.fn(async () => ({ current: null, all: {} })),
  purchasePackage: jest.fn(async () => ({ customerInfo: noPremiumCustomerInfo })),
  restorePurchases: jest.fn(async () => noPremiumCustomerInfo),
};

module.exports = {
  __esModule: true,
  default: Purchases,
  LOG_LEVEL: { VERBOSE: 'VERBOSE', DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
};
