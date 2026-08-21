/**
 * 同期の実行役（S1 — `docs/クラウド同期設計.md` §5-1b）。
 *
 * 1 回の同期 = **push（送信待ちを送る）→ pull（他端末の変更を取り込む）**。
 * 走らせるきっかけは 4 つ:
 *   - 起動（DB 準備完了後）
 *   - フォアグラウンド復帰
 *   - ローカル書き込みの数秒後（デバウンス。連続編集を 1 回にまとめる）
 *   - 変更通知（内容を持たない Expo Push）を受け取ったとき
 *
 * **失敗しても画面には出さない。** オフライン・サーバー未デプロイ（503）・鍵が無効
 * （401）のいずれも「次の機会に追いつく」で足りる。同期のためにレシピ操作を
 * 止めない、という方針（`docs/クラウド同期設計.md` §0）。
 *
 * 同期カーソル（`last_pull_seq`）は app_meta に**グループ ID とセットで**持つ。
 * app_meta はバックアップに含まれるので、別グループの端末のバックアップを復元しても
 * 他人の seq を引き継がないようにするため。
 */
import { getAppMeta, setAppMeta } from './app-meta.service';
import { getExpoPushToken } from './notification.service';
import {
  SyncError,
  getStoredCredentials,
  pullSyncChanges,
  pushSyncChanges,
  registerSyncPushToken,
  type SyncCredentials,
  type SyncPushChange,
} from './sync-client.service';
import {
  applyIncomingChange,
  buildOutgoingChange,
  listAllSyncableEntities,
} from './sync-entities.service';
import {
  SYNC_PUSH_BATCH_SIZE,
  bumpSyncQueueRetry,
  clearSyncQueue,
  enqueueSyncEntities,
  listSyncQueue,
  removeSentSyncQueueEntries,
  setSyncQueueListener,
  type SyncQueueEntry,
} from './sync-queue.service';
import { isNativePlatform } from '../db/client';
import { notifySyncApplied, setSyncing } from '../stores/sync.store';

const CURSOR_KEY = 'sync_cursor';
const PUSH_TOKEN_KEY = 'sync_push_token';

/** ローカル書き込みから送信までの待ち。連続編集を 1 回の送信にまとめる */
export const SYNC_DEBOUNCE_MS = 3000;

/** サーバー側の受け入れ上限（300KB）に余裕を持たせた値。超える 1 件は送らない */
const MAX_PAYLOAD_CHARS = 280_000;

/** pull の繰り返し上限（1 回の同期で取り込むページ数）。無限ループの保険 */
const MAX_PULL_PAGES = 20;

// ── 同期カーソル ─────────────────────────────────────────────────────────────

interface SyncCursor {
  groupId: string;
  seq: number;
}

async function readCursor(groupId: string): Promise<number> {
  const raw = await getAppMeta(CURSOR_KEY).catch(() => null);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncCursor>;
    if (parsed.groupId !== groupId) return 0; // 別のグループのカーソルは使わない
    return typeof parsed.seq === 'number' && parsed.seq >= 0 ? parsed.seq : 0;
  } catch {
    return 0;
  }
}

async function writeCursor(groupId: string, seq: number): Promise<void> {
  await setAppMeta(CURSOR_KEY, JSON.stringify({ groupId, seq } satisfies SyncCursor)).catch(
    () => undefined,
  );
}

async function resetCursor(): Promise<void> {
  await setAppMeta(CURSOR_KEY, '').catch(() => undefined);
}

// ── push ─────────────────────────────────────────────────────────────────────

interface PreparedPush {
  changes: SyncPushChange[];
  /** 送信できたら消してよい待ち行列の行（組み立て不能で捨てる分も含む） */
  entries: SyncQueueEntry[];
  /** 送りようが無いので捨てる行（送信の成否に関係なく消す） */
  dropped: SyncQueueEntry[];
}

async function preparePush(): Promise<PreparedPush> {
  const queued = await listSyncQueue(SYNC_PUSH_BATCH_SIZE);
  const changes: SyncPushChange[] = [];
  const entries: SyncQueueEntry[] = [];
  const dropped: SyncQueueEntry[] = [];

  for (const entry of queued) {
    const change = await buildOutgoingChange(entry.entityType, entry.entityId);
    if (!change) {
      dropped.push(entry); // 知らないエンティティ種別・読み出し不能
      continue;
    }
    if (change.payload !== null && change.payload.length > MAX_PAYLOAD_CHARS) {
      // 1 件が大きすぎるとバッチ全体が弾かれ、以後の同期が永久に詰まる。
      // その 1 件だけ諦める（写真を含まない S1 では現実には起きない大きさ）
      dropped.push(entry);
      continue;
    }
    changes.push(change);
    entries.push(entry);
  }
  return { changes, entries, dropped };
}

/**
 * 1 件ずつ送り直す（バッチが SERVER エラーで弾かれたときだけ通る道）。
 * 壊れた 1 件のせいで残り全部が永久に送れない、を避ける。
 */
async function pushOneByOne(prepared: PreparedPush): Promise<void> {
  for (let index = 0; index < prepared.changes.length; index += 1) {
    const change = prepared.changes[index];
    const entry = prepared.entries[index];
    if (!change || !entry) continue;
    try {
      await pushSyncChanges([change]);
      await removeSentSyncQueueEntries([entry]);
    } catch (err) {
      if (err instanceof SyncError && err.code === 'SERVER') {
        await removeSentSyncQueueEntries([entry]); // この 1 件はサーバーが受け取れない
        continue;
      }
      throw err; // ネットワーク断・認証切れは全体をやり直す
    }
  }
}

async function pushPending(): Promise<void> {
  const prepared = await preparePush();
  if (prepared.dropped.length > 0) await removeSentSyncQueueEntries(prepared.dropped);
  if (prepared.changes.length === 0) return;

  try {
    await pushSyncChanges(prepared.changes);
    await removeSentSyncQueueEntries(prepared.entries);
  } catch (err) {
    await bumpSyncQueueRetry(prepared.entries);
    if (err instanceof SyncError && err.code === 'SERVER' && prepared.changes.length > 1) {
      await pushOneByOne(prepared);
      return;
    }
    throw err;
  }
}

// ── pull ─────────────────────────────────────────────────────────────────────

async function pullAndApply(credentials: SyncCredentials): Promise<number> {
  let cursor = await readCursor(credentials.groupId);
  let applied = 0;

  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    const result = await pullSyncChanges(cursor);
    for (const change of result.changes) {
      // 自分が押した変更は適用しない（同じ内容を書き戻して updatedAt を汚さない）
      if (change.updatedByDevice === credentials.deviceId) continue;
      if (await applyIncomingChange(change)) applied += 1;
    }

    const maxSeq = result.changes.reduce((max, change) => Math.max(max, change.seq), cursor);
    const next = result.hasMore ? maxSeq : Math.max(maxSeq, result.latestSeq);
    if (next > cursor) {
      cursor = next;
      await writeCursor(credentials.groupId, cursor);
    }
    if (!result.hasMore || result.changes.length === 0) break;
  }

  return applied;
}

// ── push トークン ────────────────────────────────────────────────────────────

async function ensurePushTokenRegistered(): Promise<void> {
  try {
    const token = await getExpoPushToken();
    if (!token) return;
    if ((await getAppMeta(PUSH_TOKEN_KEY)) === token) return;
    await registerSyncPushToken(token);
    await setAppMeta(PUSH_TOKEN_KEY, token);
  } catch {
    // 通知が来ないだけ。起動時とフォアグラウンド復帰の pull で追いつく
  }
}

// ── 実行 ─────────────────────────────────────────────────────────────────────

let running: Promise<void> | null = null;
let rerunRequested = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function execute(): Promise<void> {
  const credentials = await getStoredCredentials();
  if (!credentials) return; // 未参加。同期そのものが無い
  setSyncing(true);
  try {
    await pushPending();
    const applied = await pullAndApply(credentials);
    await ensurePushTokenRegistered();
    if (applied > 0) notifySyncApplied();
  } finally {
    setSyncing(false);
  }
}

/**
 * 同期を 1 回走らせる。**例外は投げない**（呼び出し側は `void runSync()` でよい）。
 * 実行中に呼ばれたら、いま走っている回の後にもう 1 回だけ走らせる
 * （送信待ちに積まれた直後の呼び出しを取りこぼさないため）。
 */
export async function runSync(): Promise<void> {
  if (!isNativePlatform) return;
  if (running) {
    rerunRequested = true;
    return;
  }
  running = execute()
    .catch(() => undefined)
    .finally(() => {
      running = null;
    });
  await running;
  if (rerunRequested) {
    rerunRequested = false;
    await runSync();
  }
}

/** ローカル書き込みの後に呼ぶ。数秒待ってから 1 回だけ走らせる */
export function scheduleSyncSoon(delayMs: number = SYNC_DEBOUNCE_MS): void {
  if (!isNativePlatform) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSync();
  }, delayMs);
}

/** 起動時に一度呼ぶ。以後の書き込みは自動でデバウンス送信される */
export function initSync(): void {
  if (!isNativePlatform) return;
  setSyncQueueListener(() => scheduleSyncSoon());
  void runSync();
}

/**
 * グループを作った/参加した直後に呼ぶ。
 * カーソルを白紙に戻し、**いま端末にあるレシピ・帖を全部**送信待ちへ積む
 * （v1 は全量同期。参加の同意ダイアログでその旨を伝えている — 設計 §5-2）。
 */
export async function onSyncGroupJoined(): Promise<void> {
  if (!isNativePlatform) return;
  await resetCursor();
  await setAppMeta(PUSH_TOKEN_KEY, '').catch(() => undefined); // 別グループへの登録は無効
  await enqueueSyncEntities(await listAllSyncableEntities());
  await runSync();
}

/** 離脱・グループ削除の直後に呼ぶ。送信待ちとカーソルを捨てる */
export async function onSyncGroupLeft(): Promise<void> {
  if (!isNativePlatform) return;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await clearSyncQueue();
  await resetCursor();
  await setAppMeta(PUSH_TOKEN_KEY, '').catch(() => undefined);
}

/**
 * バックアップ復元のようにローカルを丸ごと入れ替えた直後に呼ぶ。
 *
 * 復元後のローカルは「バックアップを取った時点」に戻っている。カーソルを 0 に戻して
 * **サーバーの全量を取り直し**、同時にローカルの全量を積み直す。どちらが残るかは
 * 通常どおり LWW（新しい `updatedAt` の方）が決める — 復元が他端末の新しい編集を
 * 巻き戻すことも、逆に復元した内容が消えることもない。
 */
export async function onLocalDataReplaced(): Promise<void> {
  if (!isNativePlatform) return;
  await clearSyncQueue();
  await resetCursor();
  await enqueueSyncEntities(await listAllSyncableEntities());
  await runSync();
}

/** テスト用: 実行中フラグとデバウンスを初期化する */
export function resetSyncRunnerForTesting(): void {
  running = null;
  rerunRequested = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
}
