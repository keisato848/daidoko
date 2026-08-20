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

/**
 * 渡された正規化名のうち**未キャッシュのものだけ**を、枠の範囲で解決してキャッシュする。
 *
 * 呼び出し側が「何を解決するか」を決める。突合に関わるのは在庫名とレシピ材料名の
 * **両側**なので、在庫名だけを対象にしていた頃は片側しか canonical に寄らなかった
 * （docs/買い物リスト・在庫設計.md §6）。
 */
export async function resolveNames(normalizedNames: string[]): Promise<ResolveResult> {
  if (!isNativePlatform) return { resolved: 0, remaining: 0, mode: 'none', canWatchAd: false };

  const { getUncachedNames, cacheAliases } = await import('./name-alias.service');
  const uncached = await getUncachedNames(normalizedNames);
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
    const { resolveNames: resolveViaProvider } = await import('./name-resolve.provider');
    const results = await resolveViaProvider(batch);
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

/**
 * cookable の突合で当たらなかった名前（**在庫側・レシピ材料側の両方**）を解決する。
 * 旧 `resolvePantryNames` の後継。
 *
 * ルールで当たる名前は含まれないので、投げるのは「解決する価値があった名前」だけ。
 */
export async function resolveUnmatchedNames(): Promise<ResolveResult> {
  if (!isNativePlatform) return { resolved: 0, remaining: 0, mode: 'none', canWatchAd: false };

  const { getRecipeList } = await import('./recipe.service');
  const { getInStockNormalizedNames } = await import('./pantry.service');
  const { getAliasMap } = await import('./name-alias.service');
  const { collectUnmatchedNames } = await import('./cookable.service');

  const [recipes, pantry, aliases] = await Promise.all([
    getRecipeList(),
    getInStockNormalizedNames(),
    getAliasMap(),
  ]);
  return resolveNames(collectUnmatchedNames(recipes, pantry, aliases));
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
