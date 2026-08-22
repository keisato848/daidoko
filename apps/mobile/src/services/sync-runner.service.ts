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
import { SYNC_PAYLOAD_SCHEMA_VERSION } from './sync-payload';
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
import { getLocale } from '../i18n';
import { notifySyncApplied, setSyncing, setSyncJoined } from '../stores/sync.store';

const CURSOR_KEY = 'sync_cursor';

/** ローカル書き込みから送信までの待ち。連続編集を 1 回の送信にまとめる */
export const SYNC_DEBOUNCE_MS = 3000;

/** サーバー側の受け入れ上限（300KB）に余裕を持たせた値。超える 1 件は送らない */
const MAX_PAYLOAD_CHARS = 280_000;

/** pull の繰り返し上限（1 回の同期で取り込むページ数）。無限ループの保険 */
const MAX_PULL_PAGES = 20;

/** push の繰り返し上限（1 回の同期で送るバッチ数）。200 件 × 20 = 4000 件 */
const MAX_PUSH_BATCHES = 20;

// ── 同期カーソル ─────────────────────────────────────────────────────────────

interface SyncCursor {
  groupId: string;
  seq: number;
  /**
   * このカーソルを進めたときの payload の版。
   *
   * 読めなかった受信（＝自分より新しい版）はカーソルを進めて読み飛ばすので、
   * そのままではアプリを更新しても届かない。版が上がったら**カーソルを 0 に戻して
   * 取り直す**ことで、更新前に読み飛ばした分を拾い直す。
   */
  payloadVersion: number;
}

async function readCursor(groupId: string): Promise<number> {
  const raw = await getAppMeta(CURSOR_KEY).catch(() => null);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncCursor>;
    if (parsed.groupId !== groupId) return 0; // 別のグループのカーソルは使わない
    if (parsed.payloadVersion !== SYNC_PAYLOAD_SCHEMA_VERSION) return 0; // 版が変わった
    return typeof parsed.seq === 'number' && parsed.seq >= 0 ? parsed.seq : 0;
  } catch {
    return 0;
  }
}

async function writeCursor(groupId: string, seq: number): Promise<void> {
  const cursor: SyncCursor = {
    groupId,
    seq,
    payloadVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
  };
  await setAppMeta(CURSOR_KEY, JSON.stringify(cursor)).catch(() => undefined);
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
    // 積んだ時刻を渡す（行が消えていたときの tombstone の時刻＝消した時刻になる）
    const built = await buildOutgoingChange(entry.entityType, entry.entityId, entry.queuedAt);
    if (built.kind === 'unsupported') {
      dropped.push(entry); // 知らないエンティティ種別。送りようが無い
      continue;
    }
    if (built.kind === 'error') {
      // 一時的な失敗。**捨てずに残す**（次の同期でやり直す）
      continue;
    }
    if (built.change.payload !== null && built.change.payload.length > MAX_PAYLOAD_CHARS) {
      // 1 件が大きすぎるとバッチ全体が弾かれ、以後の同期が永久に詰まる。
      // その 1 件だけ諦める（写真を含まない S1 では現実には起きない大きさ）
      dropped.push(entry);
      continue;
    }
    changes.push(built.change);
    entries.push(entry);
  }
  return { changes, entries, dropped };
}

/**
 * 1 件ずつ送り直す（バッチが**サーバーに内容を拒否された**ときだけ通る道）。
 * 壊れた 1 件のせいで残り全部が永久に送れない、を避ける。
 *
 * 捨てるのは `SERVER_REJECTED`（HTTP 400 ＝ この内容では受理されないと確定した）だけ。
 * 502/504/HTML の応答は**一時障害**なので捨てない — 捨てると、再デプロイ中に
 * たまたま同期した端末の編集が丸ごと消える。
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
      if (err instanceof SyncError && err.code === 'SERVER_REJECTED') {
        await removeSentSyncQueueEntries([entry]); // この 1 件はサーバーが受け取れない
        continue;
      }
      throw err; // ネットワーク断・一時障害・認証切れは全体をやり直す
    }
  }
}

/**
 * 送信待ちを空になるまで送る。
 *
 * 1 バッチ（200 件）で終わると、蔵書の多い端末がグループに参加した直後に
 * 「一部のレシピだけ家族に見えている」状態が次の起動まで続く。
 */
async function pushPending(): Promise<void> {
  for (let batch = 0; batch < MAX_PUSH_BATCHES; batch += 1) {
    const prepared = await preparePush();
    if (prepared.dropped.length > 0) await removeSentSyncQueueEntries(prepared.dropped);
    if (prepared.changes.length === 0) return;

    try {
      await pushSyncChanges(prepared.changes);
      await removeSentSyncQueueEntries(prepared.entries);
    } catch (err) {
      await bumpSyncQueueRetry(prepared.entries);
      if (
        err instanceof SyncError &&
        err.code === 'SERVER_REJECTED' &&
        prepared.changes.length > 1
      ) {
        await pushOneByOne(prepared);
        continue;
      }
      throw err;
    }
  }
}

// ── pull ─────────────────────────────────────────────────────────────────────

/**
 * 受信して適用する。
 *
 * カーソルは**実際に受け取った変更の seq までしか進めない**。サーバーが返す
 * `latestSeq` まで飛ばすと、「変更一覧を読んだ後・最新 seq を読む前」に他端末が
 * push した分を飛び越してしまい、その変更が二度と届かなくなる（サーバーは
 * 1 エンティティ 1 行なので、再送のきっかけはその行が再編集されるまで無い）。
 *
 * カーソルを 0 から取り直すとき（初参加・再参加・バックアップ復元）は、
 * **自端末が押した分も適用する**。ローカルが古い（復元直後など）可能性があり、
 * サーバーは自分の古い push を LWW で捨てるので、取り直さないと永久に食い違う。
 */
async function pullAndApply(credentials: SyncCredentials): Promise<number> {
  const startCursor = await readCursor(credentials.groupId);
  const applyOwnChanges = startCursor === 0;
  let cursor = startCursor;
  let applied = 0;

  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    const result = await pullSyncChanges(cursor);
    let nextCursor = cursor;
    // 書き込みに失敗した変更より先へは進めない（次回の pull でやり直す）
    let blocked = false;

    for (const change of result.changes) {
      if (!applyOwnChanges && change.updatedByDevice === credentials.deviceId) {
        // 自分が押した変更（同じ内容を書き戻して updatedAt を汚さない）
        if (!blocked) nextCursor = Math.max(nextCursor, change.seq);
        continue;
      }
      const outcome = await applyIncomingChange(change);
      if (outcome === 'failed') {
        blocked = true;
        continue;
      }
      if (outcome === 'applied') applied += 1;
      if (!blocked) nextCursor = Math.max(nextCursor, change.seq);
    }

    if (nextCursor > cursor) {
      cursor = nextCursor;
      await writeCursor(credentials.groupId, cursor);
    }
    if (blocked) break;
    if (!result.hasMore || result.changes.length === 0) break;
  }

  return applied;
}

// ── push トークン ────────────────────────────────────────────────────────────

/**
 * この起動で 1 回だけトークンを登録する。
 *
 * **DB（app_meta）には残さない。** app_meta はバックアップ・移行 ZIP に入るので、
 * 端末に紐づく push トークンが端末外へ出てしまう（トークンを持つ人はその端末へ
 * 通知を送れる）。起動ごとに 1 回 PATCH するだけなら通信量も無視できる。
 *
 * 表示言語も一緒に渡す。通知の文面をサーバー側で選ぶために要る（内容は持たない）。
 */
let registeredPushToken: string | null = null;

async function ensurePushTokenRegistered(): Promise<void> {
  try {
    const token = await getExpoPushToken();
    if (!token || token === registeredPushToken) return;
    await registerSyncPushToken(token, getLocale());
    registeredPushToken = token;
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
  // 画面が「個人/家族」の切り替えを出すかの判断に使う（設計 §5-2）
  setSyncJoined(credentials !== null);
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
  setSyncJoined(true);
  registeredPushToken = null; // 新しいグループへ登録し直す
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
  setSyncJoined(false);
  registeredPushToken = null;
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
  registeredPushToken = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
}
