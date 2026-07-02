/* global jest */
/**
 * Manual Jest mock for expo-secure-store — an in-memory keychain so unit tests
 * never touch the native secure store. Call __clearStore() in beforeEach to reset.
 */
let store = {};

module.exports = {
  getItemAsync: jest.fn(async (key) => (key in store ? store[key] : null)),
  setItemAsync: jest.fn(async (key, value) => {
    store[key] = value;
  }),
  deleteItemAsync: jest.fn(async (key) => {
    delete store[key];
  }),
  __clearStore: () => {
    store = {};
  },
};
