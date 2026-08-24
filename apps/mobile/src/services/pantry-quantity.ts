/**
 * 在庫数量のデルタ同期（S2-B — `docs/クラウド同期設計.md` §5-3）の**純関数**。
 *
 * I/O を持たない（jest から直接叩ける — `docs/品質基準.md` §2.3「判断のいるロジックは純関数へ」）。
 * DB を触る側は `pantry.service.ts`（送信）と `sync-row-entities.service.ts`（受信）。
 *
 * 考え方（§5-3-0）:
 * - 数量は「+2」「−1」の操作を運ぶのではなく、**端末ごとの累計増減（持ち分 = part）を状態として**
 *   行 LWW に載せる。part の書き手は 1 台だけなので競合せず、状態なので何度再適用しても同じ値
 * - 表示値 `quantity` = `max(0, base + Σ net)`。base と epoch（ベースラインの世代）は行が持つ
 * - epoch が上がったら（共有 0→1・絶対値セット）古い世代の part は Σ から外れる
 */

/** 1 つの持ち分（`pantry_quantity_parts` の 1 行） */
export interface QuantityPart {
  deviceId: string;
  net: number | null;
  epoch: number | null;
}

/**
 * 生の合計。`base` が NULL かつ有効な part が無ければ NULL（＝数量未管理）。
 * Σ は **行と同じ epoch の part だけ**（繰り上げ前の持ち分・離脱端末の旧世代は効かない）。
 */
export function computeRaw(
  base: number | null,
  parts: readonly QuantityPart[],
  epoch: number | null,
): number | null {
  const rowEpoch = epoch ?? 0;
  const relevant = parts.filter((p) => (p.epoch ?? 0) === rowEpoch);
  if (base == null && relevant.length === 0) return null;
  return (base ?? 0) + relevant.reduce((sum, p) => sum + (p.net ?? 0), 0);
}

/** 実体化値（表示・在庫判定・残量通知・バックアップが読む列）。負は 0 に寄せる */
export function displayQuantity(raw: number | null): number | null {
  if (raw == null) return null;
  return Math.max(0, raw);
}

/**
 * タップの δ を「この端末の持ち分に足す量」へ直す（§5-3-2・審査④）。
 *
 * raw が負のとき（残り 1 個を 2 台が同時に消費した等）、表示は 0 だが生値は −1。
 * 「+」を 1 回押したら表示 1 にしたいので、持ち分には `target − raw` を足す。
 * 見た目が変わらないタップ（表示 0 で「−」）は `null` を返す＝何も書かない。
 */
export function effectiveDelta(raw: number | null, delta: number): number | null {
  const displayed = displayQuantity(raw);
  const target = Math.max(0, (displayed ?? 0) + delta);
  if (raw != null && target === displayed) return null;
  return target - (raw ?? 0);
}

/** part の entity_id = `<品目 id>:<端末 id>`（59 字。サーバーの上限 128 に収まる — §5-3 審査⑦） */
export function partEntityId(itemId: string, deviceId: string): string {
  return `${itemId}:${deviceId}`;
}

export function parsePartEntityId(entityId: string): { itemId: string; deviceId: string } | null {
  const at = entityId.indexOf(':');
  if (at <= 0 || at === entityId.length - 1) return null;
  return { itemId: entityId.slice(0, at), deviceId: entityId.slice(at + 1) };
}

/**
 * ISO 時刻 → epoch（ミリ秒の整数）。**全端末で同じ値になること**が要件なので
 * `Date.parse` を使う（SQLite の `julianday` は浮動小数で 1ms ずれうる）。読めなければ 0。
 */
export function epochOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** 繰り上げ後の epoch。前の値より必ず大きく、ふつうは「いま」 */
export function nextEpoch(previous: number | null, nowMs: number): number {
  return Math.max((previous ?? 0) + 1, nowMs);
}

/**
 * part の `updated_at`（LWW 基準）。端末内で**単調**にする（§5-3-0 I4）。
 * 時計を戻しても、自分の次のタップが自分の前のタップに負けない。
 */
export function monotonicStamp(previousIso: string | null | undefined, nowMs: number): string {
  const prev = previousIso ? Date.parse(previousIso) : Number.NaN;
  const ms = Number.isFinite(prev) ? Math.max(prev + 1, nowMs) : nowMs;
  return new Date(ms).toISOString();
}

/**
 * 受信した行の base/epoch を採用するか（§5-3-3）。行 LWW とは独立に決める:
 * - 世代が新しければ採用（別端末の「名前だけ直した新しい行」に負けない）
 * - 同じ世代なら行 LWW に従う
 * - 古い世代なら採用しない
 */
export function decideQuantityAdoption(
  incomingEpoch: number,
  localEpoch: number | null,
  lwwWins: boolean,
): boolean {
  const local = localEpoch ?? 0;
  if (incomingEpoch > local) return true;
  if (incomingEpoch === local) return lwwWins;
  return false;
}

/**
 * 旧版（v2）の行 payload のベースライン。「旧端末が見ていた絶対値 q を、その行の `updatedAt` を
 * 世代にしたベースライン」と読む（§5-3-3）。v2→v3 に更新した端末の移行ベースライン
 * （`epochOf(updated_at)`・`quantity`）と**同じ値**になるので、更新後に端末間で食い違わない。
 */
export function legacyBaseline(item: {
  quantity: number | null;
  updatedAt: string;
  quantityBase?: number | null | undefined;
  quantityEpoch?: number | null | undefined;
}): { base: number | null; epoch: number } {
  if (typeof item.quantityEpoch === 'number' && Number.isFinite(item.quantityEpoch)) {
    return { base: item.quantityBase ?? null, epoch: item.quantityEpoch };
  }
  return { base: item.quantity, epoch: epochOf(item.updatedAt) };
}
