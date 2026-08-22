/**
 * 在庫数量の持ち分 — DB を触る側（S2-B・設計 §5-3）。純関数は `pantry-quantity.ts`。
 *
 * ここにあるのは「ベースライン化」「再実体化」「持ち分の読み書き」だけ。
 * **`pantry.service` を経由せず `db.update` で直書きする**（§5-3-8 #6）— 受信適用中は
 * その part の鍵しか抑止されておらず、service 経由で行を書くと `sync_queue` に積まれて
 * 押し返しループになる。
 */
import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { computeRaw, displayQuantity, epochOf, type QuantityPart } from './pantry-quantity';

export interface QuantityRow {
  id: string;
  quantity: number | null;
  quantityBase: number | null;
  quantityEpoch: number | null;
  updatedAt: string;
}

async function dz() {
  return import('drizzle-orm');
}

/** 品目の持ち分を全部読む */
export async function readParts(
  itemId: string,
): Promise<(QuantityPart & { updatedAt: string | null })[]> {
  const { eq } = await dz();
  const rows = await getDb()
    .select({
      deviceId: schema.pantryQuantityParts.deviceId,
      net: schema.pantryQuantityParts.net,
      epoch: schema.pantryQuantityParts.epoch,
      updatedAt: schema.pantryQuantityParts.updatedAt,
    })
    .from(schema.pantryQuantityParts)
    .where(eq(schema.pantryQuantityParts.itemId, itemId));
  return rows;
}

/**
 * v16 未移行の行（`quantity_epoch IS NULL`）にベースラインを与える（§5-3-0 I6）。
 * epoch は `Date.parse(updated_at)`（JS で。全端末で同じ値になる）、base は `quantity`。
 * **実体化値から base を作り直す経路はこれだけ**。epoch が非 NULL の行は二度と触らない。
 */
export async function ensureRowBaseline(row: QuantityRow): Promise<QuantityRow> {
  if (row.quantityEpoch != null) return row;
  const { eq } = await dz();
  const epoch = epochOf(row.updatedAt);
  await getDb()
    .update(schema.pantryItems)
    .set({ quantityBase: row.quantity, quantityEpoch: epoch })
    .where(eq(schema.pantryItems.id, row.id));
  return { ...row, quantityBase: row.quantity, quantityEpoch: epoch };
}

/** 起動・復元の直後に、未移行の行をまとめてベースライン化する */
export async function ensureQuantityBaseline(): Promise<void> {
  if (!isNativePlatform) return;
  const { isNull } = await dz();
  const rows = await getDb()
    .select({
      id: schema.pantryItems.id,
      quantity: schema.pantryItems.quantity,
      quantityBase: schema.pantryItems.quantityBase,
      quantityEpoch: schema.pantryItems.quantityEpoch,
      updatedAt: schema.pantryItems.updatedAt,
    })
    .from(schema.pantryItems)
    .where(isNull(schema.pantryItems.quantityEpoch));
  for (const row of rows) await ensureRowBaseline(row);
}

/** 行を読む（無ければ null） */
export async function readQuantityRow(itemId: string): Promise<QuantityRow | null> {
  const { eq } = await dz();
  const rows = await getDb()
    .select({
      id: schema.pantryItems.id,
      quantity: schema.pantryItems.quantity,
      quantityBase: schema.pantryItems.quantityBase,
      quantityEpoch: schema.pantryItems.quantityEpoch,
      updatedAt: schema.pantryItems.updatedAt,
    })
    .from(schema.pantryItems)
    .where(eq(schema.pantryItems.id, itemId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 再実体化: `quantity := max(0, base + Σ)`（§5-3-0 I1）。
 * **`updated_at` を触らず、`sync_queue` にも積まない**。戻り値は生の合計。
 */
export async function rematerialize(itemId: string): Promise<number | null> {
  const row = await readQuantityRow(itemId);
  if (!row) return null;
  const based = await ensureRowBaseline(row);
  const parts = await readParts(itemId);
  const raw = computeRaw(based.quantityBase, parts, based.quantityEpoch);
  const display = displayQuantity(raw);
  if (display !== based.quantity) {
    const { eq } = await dz();
    await getDb()
      .update(schema.pantryItems)
      .set({ quantity: display })
      .where(eq(schema.pantryItems.id, itemId));
  }
  return raw;
}

/** 起動時の自己修復（part の upsert と quantity の UPDATE の間で落ちても次の起動で直る） */
export async function rematerializeAll(): Promise<void> {
  if (!isNativePlatform) return;
  const rows = await getDb().select({ id: schema.pantryItems.id }).from(schema.pantryItems);
  for (const row of rows) await rematerialize(row.id);
}

/** 品目の持ち分を全部消す（行の削除・繰り上げ・畳み込み） */
export async function deleteParts(itemId: string): Promise<void> {
  const { eq } = await dz();
  await getDb()
    .delete(schema.pantryQuantityParts)
    .where(eq(schema.pantryQuantityParts.itemId, itemId));
}

/** 行の epoch と違う世代の持ち分を消す（繰り上げを受信したとき — §5-3-3 審査③） */
export async function deletePartsNotInEpoch(itemId: string, epoch: number): Promise<void> {
  const { and, eq, ne, isNull, or } = await dz();
  await getDb()
    .delete(schema.pantryQuantityParts)
    .where(
      and(
        eq(schema.pantryQuantityParts.itemId, itemId),
        or(isNull(schema.pantryQuantityParts.epoch), ne(schema.pantryQuantityParts.epoch, epoch)),
      ),
    );
}

/** 持ち分の upsert（送信側・受信側の両方から） */
export async function upsertPart(part: {
  itemId: string;
  deviceId: string;
  net: number;
  epoch: number;
  updatedAt: string;
}): Promise<void> {
  await getDb()
    .insert(schema.pantryQuantityParts)
    .values(part)
    .onConflictDoUpdate({
      target: [schema.pantryQuantityParts.itemId, schema.pantryQuantityParts.deviceId],
      set: { net: part.net, epoch: part.epoch, updatedAt: part.updatedAt },
    });
}

export async function readPart(
  itemId: string,
  deviceId: string,
): Promise<{ net: number | null; epoch: number | null; updatedAt: string | null } | null> {
  const { and, eq } = await dz();
  const rows = await getDb()
    .select({
      net: schema.pantryQuantityParts.net,
      epoch: schema.pantryQuantityParts.epoch,
      updatedAt: schema.pantryQuantityParts.updatedAt,
    })
    .from(schema.pantryQuantityParts)
    .where(
      and(
        eq(schema.pantryQuantityParts.itemId, itemId),
        eq(schema.pantryQuantityParts.deviceId, deviceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
