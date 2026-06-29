/**
 * JAN catalog service — remembers JAN(barcode)→name/unit locally so a scanned
 * product auto-fills after the first time it is named. Family-scoped; web no-ops.
 * See docs/買い物リスト・在庫設計.md §5.2.
 */
import { isNativePlatform } from '../db/client';
import { generateId } from '../utils/id';

export interface JanEntry {
  name: string;
  unit: string | null;
}

async function currentFamilyId(): Promise<string> {
  const { getCurrentFamily } = await import('./user.service');
  return getCurrentFamily().id;
}

/** Look up a remembered product by JAN code. */
export async function lookupJan(janCode: string): Promise<JanEntry | null> {
  if (!isNativePlatform || !janCode) return null;
  const { and, eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');

  const rows = await getDb()
    .select({ name: schema.janCatalog.name, unit: schema.janCatalog.unit })
    .from(schema.janCatalog)
    .where(
      and(
        eq(schema.janCatalog.familyId, await currentFamilyId()),
        eq(schema.janCatalog.janCode, janCode),
      ),
    )
    .limit(1);

  return rows.length > 0 ? { name: rows[0].name, unit: rows[0].unit } : null;
}

/** Remember (upsert) a JAN→name/unit mapping. */
export async function rememberJan(
  janCode: string,
  name: string,
  unit?: string | null,
): Promise<void> {
  const trimmedName = name.trim();
  if (!isNativePlatform || !janCode || !trimmedName) return;
  const { and, eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const familyId = await currentFamilyId();
  const now = new Date().toISOString();
  const unitValue = unit?.trim() ? unit.trim() : null;

  const existing = await db
    .select({ id: schema.janCatalog.id })
    .from(schema.janCatalog)
    .where(and(eq(schema.janCatalog.familyId, familyId), eq(schema.janCatalog.janCode, janCode)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.janCatalog)
      .set({ name: trimmedName, unit: unitValue, updatedAt: now })
      .where(eq(schema.janCatalog.id, existing[0].id));
  } else {
    await db.insert(schema.janCatalog).values({
      id: generateId(),
      familyId,
      janCode,
      name: trimmedName,
      unit: unitValue,
      updatedAt: now,
    });
  }
}
