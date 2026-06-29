jest.mock('../../db/client', () => ({ isNativePlatform: true }));

import * as SecureStore from 'expo-secure-store';

import {
  clearUserApiKey,
  getUserApiKey,
  hasUserApiKey,
  looksLikeApiKey,
  setUserApiKey,
} from '../byok.service';

const resetStore = (): void =>
  (SecureStore as unknown as { __clearStore: () => void }).__clearStore();

describe('byok.service', () => {
  beforeEach(resetStore);

  describe('looksLikeApiKey', () => {
    it('accepts a long, space-free key and rejects others', () => {
      expect(looksLikeApiKey('AIzaSyA1234567890abcdefghijklmnop')).toBe(true);
      expect(looksLikeApiKey('short')).toBe(false);
      expect(looksLikeApiKey('has spaces in the key here xxxxxx')).toBe(false);
      expect(looksLikeApiKey('   ')).toBe(false);
    });
  });

  it('stores (trimmed), reads, reports, and clears the key', async () => {
    expect(await getUserApiKey()).toBeNull();
    expect(await hasUserApiKey()).toBe(false);

    await setUserApiKey('  my-very-long-api-key-1234567890  ');
    expect(await getUserApiKey()).toBe('my-very-long-api-key-1234567890');
    expect(await hasUserApiKey()).toBe(true);

    await clearUserApiKey();
    expect(await getUserApiKey()).toBeNull();
    expect(await hasUserApiKey()).toBe(false);
  });

  it('treats a blank key as clear', async () => {
    await setUserApiKey('some-long-enough-api-key-1234567890');
    await setUserApiKey('   ');
    expect(await getUserApiKey()).toBeNull();
  });
});
