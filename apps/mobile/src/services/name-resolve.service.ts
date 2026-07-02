/**
 * Name-resolution service — resolves uncached pantry names to canonical
 * ingredient names and caches them, gated by tier:
 *   BYOK / premium → unlimited; free → a small daily quota + rewarded-ad bonus.
 * No AI / offline / quota-out → does nothing (matching silently falls back to
 * the substring baseline; never errors). See docs/買い物リスト・在庫設計.md §6.
 */
import { isNativePlatform } from '../db/client';
import { normalizeItemName } from '../utils/itemName';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { getUserApiKey } from './byok.service';
import { currentDayKey } from './usage.service';

export const NAME_RESOLVE_FREE_DAILY = 30;
export const NAME_RESOLVE_AD_BONUS = 30;
export const NAME_RESOLVE_AD_BONUS_CAP = 90;

const USAGE_KEY_PREFIX = 'ai_name_resolve_usage:';
const BONUS_KEY_PREFIX = 'ai_name_resolve_bonus:';

export type ResolveMode = 'byok' | 'premium' | 'free' | 'none';

export interface ResolveResult {
  resolved: number; // names newly cached this call
  remaining: number; // uncached names still needing resolution
  mode: ResolveMode;
  canWatchAd: boolean; // free + quota exhausted + names remain
}

async function readInt(key: string): Promise<number> {
  const raw = await getAppMeta(key);
  const value = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function getResolveMode(): Promise<ResolveMode> {
  if (!isNativePlatform) return 'none';
  if (await getUserApiKey()) return 'byok';
  const { isPremium } = await import('./entitlement.service');
  if (await isPremium()) return 'premium';
  return 'free';
}

/** Free resolutions remaining today (daily quota + ad bonus − used). */
export async function getFreeResolveRemaining(): Promise<number> {
  const day = currentDayKey();
  const used = await readInt(USAGE_KEY_PREFIX + day);
  const bonus = await readInt(BONUS_KEY_PREFIX + day);
  return Math.max(0, NAME_RESOLVE_FREE_DAILY + bonus - used);
}

/** Resolve as many uncached pantry names as the tier/quota allows, then cache. */
export async function resolvePantryNames(): Promise<ResolveResult> {
  if (!isNativePlatform) return { resolved: 0, remaining: 0, mode: 'none', canWatchAd: false };

  const { getInStockNormalizedNames } = await import('./pantry.service');
  const { getUncachedNames, cacheAliases } = await import('./name-alias.service');
  const pantryNames = await getInStockNormalizedNames();
  const uncached = await getUncachedNames(pantryNames);
  const mode = await getResolveMode();
  if (uncached.length === 0 || mode === 'none') {
    return { resolved: 0, remaining: uncached.length, mode, canWatchAd: false };
  }

  const budget =
    mode === 'free' ? Math.min(await getFreeResolveRemaining(), uncached.length) : uncached.length;
  if (budget <= 0) {
    return { resolved: 0, remaining: uncached.length, mode, canWatchAd: true };
  }

  const batch = uncached.slice(0, budget);
  try {
    const { resolveNames } = await import('./name-resolve.provider');
    const results = await resolveNames(batch);
    // Non-food (empty canonical) caches to itself so it isn't re-asked and can't
    // spuriously match; otherwise cache the normalized canonical ingredient name.
    const byName = new Map(results.map((r) => [r.name, r.canonical]));
    const entries = batch.map((source) => {
      const canonicalRaw = byName.get(source) ?? '';
      const canonical = canonicalRaw.trim() ? normalizeItemName(canonicalRaw) : source;
      return { sourceNormalized: source, canonical };
    });
    await cacheAliases(entries);

    if (mode === 'free') {
      const day = currentDayKey();
      const used = await readInt(USAGE_KEY_PREFIX + day);
      await setAppMeta(USAGE_KEY_PREFIX + day, String(used + batch.length));
    }

    const remaining = uncached.length - batch.length;
    return {
      resolved: entries.length,
      remaining,
      mode,
      canWatchAd: mode === 'free' && remaining > 0,
    };
  } catch {
    return { resolved: 0, remaining: uncached.length, mode, canWatchAd: false };
  }
}

/** Grant an ad-unlocked bonus batch of resolutions (free tier). */
export async function grantResolveAdBonus(): Promise<void> {
  if (!isNativePlatform) return;
  const day = currentDayKey();
  const bonus = await readInt(BONUS_KEY_PREFIX + day);
  await setAppMeta(
    BONUS_KEY_PREFIX + day,
    String(Math.min(NAME_RESOLVE_AD_BONUS_CAP, bonus + NAME_RESOLVE_AD_BONUS)),
  );
}
