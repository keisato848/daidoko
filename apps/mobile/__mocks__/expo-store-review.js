/* global jest */
/**
 * Manual Jest mock for expo-store-review — keeps the native module out of unit
 * tests. Availability defaults to true; requestReview resolves silently.
 */
module.exports = {
  isAvailableAsync: jest.fn(async () => true),
  requestReview: jest.fn(async () => undefined),
  hasAction: jest.fn(async () => true),
};
