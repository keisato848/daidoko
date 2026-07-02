/**
 * BYOK (bring-your-own-key) — the user's own Gemini API key, stored encrypted in
 * the OS keychain/keystore via expo-secure-store. When set, the app calls Gemini
 * directly from the device (no server) and the freemium quota is bypassed
 * (the user pays Google directly). See docs/フリーミアム設計.md §9.
 */
import * as SecureStore from 'expo-secure-store';

import { isNativePlatform } from '../db/client';

const KEY_STORE_ID = 'gemini_api_key';

/** Returns the stored user Gemini key, or null. Never throws. */
export async function getUserApiKey(): Promise<string | null> {
  if (!isNativePlatform) return null;
  try {
    const value = await SecureStore.getItemAsync(KEY_STORE_ID);
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export async function hasUserApiKey(): Promise<boolean> {
  return (await getUserApiKey()) !== null;
}

/** Persist (or, with empty input, clear) the user's Gemini key. */
export async function setUserApiKey(key: string): Promise<void> {
  if (!isNativePlatform) return;
  const trimmed = key.trim();
  if (!trimmed) {
    await clearUserApiKey();
    return;
  }
  await SecureStore.setItemAsync(KEY_STORE_ID, trimmed);
}

export async function clearUserApiKey(): Promise<void> {
  if (!isNativePlatform) return;
  try {
    await SecureStore.deleteItemAsync(KEY_STORE_ID);
  } catch {
    // already absent — nothing to do
  }
}

/** Loose sanity check for a Google AI Studio key (not validation, just UX). */
export function looksLikeApiKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.length >= 20 && !/\s/.test(trimmed);
}
