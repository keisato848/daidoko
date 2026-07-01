/**
 * Name-alias cache — stores AI-resolved "messy name → canonical ingredient name"
 * so each name is resolved once and remembered (like the JAN catalog). The
 * matcher (utils/itemMatch) reads this map; no synonym dictionary lives in
 * source. Family-scoped; web returns empty / no-ops. See
 * docs/買い物リスト・在庫設計.md §6.
 */
import { isNativePlatform } from '../db/client';
import { generateId } from '../utils/id';

export interface AliasEntry {
  sourceNormalized: string;
  canonical: string;
}

async function currentFamilyId(): Promise<string> {
  const { getCurrentFamily } = await import('./user.service');
  return getCurrentFamily().id;
}

/** Map of normalized source name → canonical name (the resolution cache). */
export async function getAliasMap(): Promise<Record<string, string>> {
  if (!isNativePlatform) return {};
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const rows = await getDb()
    .select({
      source: schema.nameAliases.sourceNormalized,
      canonical: schema.nameAliases.canonical,
    })
    .from(schema.nameAliases)
    .where(eq(schema.nameAliases.familyId, await currentFamilyId()));

  const map: Record<string, string> = {};
  for (const row of rows) map[row.source] = row.canonical;
  return map;
}

/** Distinct normalized names not yet in the cache (i.e. that need resolving). */
export async function getUncachedNames(normalizedNames: string[]): Promise<string[]> {
  const map = await getAliasMap();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of normalizedNames) {
    if (name && !(name in map) && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

/** Upsert resolved aliases. */
export async function cacheAliases(entries: AliasEntry[]): Promise<void> {
  if (!isNativePlatform || entries.length === 0) return;
  const { and, eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const familyId = await currentFamilyId();
  const now = new Date().toISOString();

  for (const entry of entries) {
    if (!entry.sourceNormalized || !entry.canonical) continue;
    const existing = await db
      .select({ id: schema.nameAliases.id })
      .from(schema.nameAliases)
      .where(
        and(
          eq(schema.nameAliases.familyId, familyId),
          eq(schema.nameAliases.sourceNormalized, entry.sourceNormalized),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(schema.nameAliases)
        .set({ canonical: entry.canonical, updatedAt: now })
        .where(eq(schema.nameAliases.id, existing[0].id));
    } else {
      await db.insert(schema.nameAliases).values({
        id: generateId(),
        familyId,
        sourceNormalized: entry.sourceNormalized,
        canonical: entry.canonical,
        updatedAt: now,
      });
    }
  }
}
