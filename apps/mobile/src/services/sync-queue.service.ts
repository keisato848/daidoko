/**
 * 同期の送信待ちキュー（S1 — `docs/クラウド同期設計.md` §5-1b）。
 *
 * 積むのは `{entity_type, entity_id}` の**印だけ**。payload は送信の直前に最新の DB から
 * 作り直す（`sync-entities.service.ts`）ので、連続編集は自然に 1 回の送信へ合流する。
 * 主キーが (entity_type, entity_id) なので、同じ行を何度直しても待ち行列は 1 行のまま。
 *
 * **絶対に例外を投げない。** ここはレシピ保存など既存の書き込みの末尾に差し込まれる。
 * 同期の都合で「保存できませんでした」を出すのは本末転倒なので、失敗は黙って捨てる
 * （取りこぼしても、グループ参加時の全件積み直しと次回以降の編集で追いつく）。
 *
 * 依存の向き: recipe.service → **sync-queue** → （コールバックで）sync-runner。
 * runner を直接 import しない（runner はこのモジュールを import するので循環する）。
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import type { SyncEntityType } from './sync-payload';

export interface SyncQueueEntry {
  entityType: string;
  entityId: string;
  queuedAt: string;
  retryCount: number;
}

/** 1 回の push で送る上限。サーバー側の上限（200 件）に合わせる */
export const SYNC_PUSH_BATCH_SIZE = 200;

// ── 受信適用中の抑止 ─────────────────────────────────────────────────────────
// 受信した変更をローカルへ書くときも DB の書き込みなので、素直に配線すると
// 「受け取った変更をそのまま押し返す」無限往復になる。適用中はキューに積まない。
//
// **抑止は「いま適用しているその 1 行」だけに効かせる。** 全体を止めると、適用の
// await の合間に利用者が別のレシピを保存したとき、その編集が積まれず永久に送られない
// （適用は 1 件ごとに数回 await するので、窓は小さいが確実に存在する）。

const applyingKeys = new Map<string, number>();

function applyKey(entityType: string, entityId: string): string {
  return `${entityType}::${entityId}`;
}

export function isApplyingRemoteChange(entityType: string, entityId: string): boolean {
  return (applyingKeys.get(applyKey(entityType, entityId)) ?? 0) > 0;
}

/** その 1 行の受信適用の間だけ enqueue を止める。ネストしても正しく戻る */
export async function withRemoteApply<T>(
  entityType: string,
  entityId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = applyKey(entityType, entityId);
  applyingKeys.set(key, (applyingKeys.get(key) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const depth = (applyingKeys.get(key) ?? 1) - 1;
    if (depth <= 0) applyingKeys.delete(key);
    else applyingKeys.set(key, depth);
  }
}

// ── 変更があったことを積む ───────────────────────────────────────────────────

let onEnqueued: (() => void) | null = null;

/** 積まれたことを sync-runner へ知らせる口（runner が起動時に登録する） */
export function setSyncQueueListener(listener: (() => void) | null): void {
  onEnqueued = listener;
}

/**
 * 「この行が変わった」を積む。グループ未参加でも積んでよい
 * （待ち行列はエンティティ数を超えないので溜まっても数百行。参加した瞬間に意味を持つ）。
 */
export async function enqueueSyncEntity(
  entityType: SyncEntityType,
  entityId: string,
): Promise<void> {
  if (!isNativePlatform || !entityId || isApplyingRemoteChange(entityType, entityId)) return;
  try {
    const queuedAt = new Date().toISOString();
    await getDb()
      .insert(schema.syncQueue)
      .values({ entityType, entityId, queuedAt, retryCount: 0 })
      .onConflictDoUpdate({
        target: [schema.syncQueue.entityType, schema.syncQueue.entityId],
        set: { queuedAt, retryCount: 0 },
      });
    onEnqueued?.();
  } catch {
    // 同期は「あとで追いつく」もの。ここで元の保存を失敗させない
  }
}

/** 複数まとめて積む（グループ参加時の全件積み直しなど） */
export async function enqueueSyncEntities(
  entries: readonly { entityType: SyncEntityType; entityId: string }[],
): Promise<void> {
  for (const entry of entries) {
    await enqueueSyncEntity(entry.entityType, entry.entityId);
  }
}

// ── 送信側から使う操作 ───────────────────────────────────────────────────────

/** 古いものから取り出す（送信の順序を安定させる） */
export async function listSyncQueue(limit = SYNC_PUSH_BATCH_SIZE): Promise<SyncQueueEntry[]> {
  if (!isNativePlatform) return [];
  try {
    return await getDb()
      .select()
      .from(schema.syncQueue)
      .orderBy(asc(schema.syncQueue.queuedAt))
      .limit(limit);
  } catch {
    return [];
  }
}

/**
 * 送信できた分を消す。
 *
 * **`queuedAt` が積んだ時刻と変わっていない行だけ**を消す。送信中に同じレシピが
 * 編集されると `queuedAt` が進む（`onConflictDoUpdate`）ので、この条件が無いと
 * 「送信中に入った編集」が消えて二度と送られない。
 */
export async function removeSentSyncQueueEntries(
  entries: readonly SyncQueueEntry[],
): Promise<void> {
  if (!isNativePlatform || entries.length === 0) return;
  const db = getDb();
  for (const entry of entries) {
    try {
      await db
        .delete(schema.syncQueue)
        .where(
          and(
            eq(schema.syncQueue.entityType, entry.entityType),
            eq(schema.syncQueue.entityId, entry.entityId),
            eq(schema.syncQueue.queuedAt, entry.queuedAt),
          ),
        );
    } catch {
      // 次回の送信で消える
    }
  }
}

/** 送信に失敗した回数を増やす（捨てはしない。次の起動で再挑戦する） */
export async function bumpSyncQueueRetry(entries: readonly SyncQueueEntry[]): Promise<void> {
  if (!isNativePlatform || entries.length === 0) return;
  const ids = entries.map((entry) => entry.entityId);
  try {
    await getDb()
      .update(schema.syncQueue)
      .set({ retryCount: sql`${schema.syncQueue.retryCount} + 1` })
      .where(inArray(schema.syncQueue.entityId, ids));
  } catch {
    // 回数が増えないだけ。挙動は変わらない
  }
}

/** グループから抜けたときなど、送信待ちを白紙に戻す */
export async function clearSyncQueue(): Promise<void> {
  if (!isNativePlatform) return;
  try {
    await getDb().delete(schema.syncQueue);
  } catch {
    // 次回の参加時に全件積み直すので実害なし
  }
}
