/**
 * クラウド同期のクライアント（S0: グループ・端末・認証 — docs/クラウド同期設計.md §2）。
 *
 * アカウントは無い。端末はサーバーが発行した「端末 ID ＋シークレット」で名乗り、
 * クレデンシャルは **expo-secure-store にだけ**置く（DB・バックアップに含めない —
 * 移行 ZIP に混ざると他人の端末がグループに成りすませてしまう）。
 *
 * 失敗は必ず {@link SyncError} に写して投げる。サーバーが古い・DB 未接続（503）・
 * オフラインでも、生の fetch 例外やサーバーの文言を画面に出さない
 * （Issue #202 / 新経路はサーバー未デプロイでも落ちない形にする、の方針）。
 * push/pull（S1）はこの上に載せる。
 */
import * as SecureStore from 'expo-secure-store';

import { API_V1 } from '../config';
import { isNativePlatform } from '../db/client';

const CREDENTIALS_KEY = 'sync_credentials_v1';

export type SyncErrorCode =
  /** サーバーに同期の口が無い（未デプロイ・DB 未接続）。時間をおけば直る可能性 */
  | 'SYNC_UNAVAILABLE'
  | 'INVITE_INVALID'
  | 'INVITE_EXPIRED'
  | 'GROUP_FULL'
  | 'RATE_LIMITED'
  | 'OWNER_ONLY'
  /** クレデンシャルが無効（グループ削除・端末削除済み）。ローカルの資格情報は消してある */
  | 'AUTH_INVALID'
  /** 既にグループに入っている（先に離脱が必要 — 旧グループのクレデンシャルを黙って捨てない） */
  | 'ALREADY_JOINED'
  | 'NETWORK'
  /**
   * サーバーが**この内容を受け付けない**と確定した（HTTP 400）。
   * 送り直しても通らないので、送信待ちから捨ててよい唯一のケース。
   */
  | 'SERVER_REJECTED'
  /** それ以外のサーバー側の失敗（502/504/HTML 応答など）。**一時障害として扱う** */
  | 'SERVER';

export class SyncError extends Error {
  constructor(public readonly code: SyncErrorCode) {
    super(`sync: ${code}`);
    this.name = 'SyncError';
  }
}

export interface SyncCredentials {
  groupId: string;
  deviceId: string;
  deviceSecret: string;
}

export interface SyncGroupCreated extends SyncCredentials {
  inviteCode: string;
  inviteExpiresAt: string;
}

export interface SyncMe {
  groupId: string;
  deviceId: string;
  isOwner: boolean;
  memberCount: number;
  /** オーナーにだけ返る */
  inviteCode?: string;
  inviteExpiresAt?: string;
}

export type SyncState =
  | { kind: 'unavailable' } // Web など secure-store の無い環境
  | { kind: 'none' } // 未参加
  | { kind: 'joined'; credentials: SyncCredentials };

// ── クレデンシャルの保管（secure-store のみ） ────────────────────────────────

// 静的 import（jest は動的 import を実行できない — メモリ既知の制約）。
// Web では expo-secure-store の関数は使えないが、isNativePlatform ガードで呼ばれない

export async function getStoredCredentials(): Promise<SyncCredentials | null> {
  if (!isNativePlatform) return null;
  const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncCredentials>;
    if (!parsed.groupId || !parsed.deviceId || !parsed.deviceSecret) return null;
    return {
      groupId: parsed.groupId,
      deviceId: parsed.deviceId,
      deviceSecret: parsed.deviceSecret,
    };
  } catch {
    return null;
  }
}

async function storeCredentials(credentials: SyncCredentials): Promise<void> {
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials));
}

async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY).catch(() => undefined);
}

export async function getSyncState(): Promise<SyncState> {
  if (!isNativePlatform) return { kind: 'unavailable' };
  const credentials = await getStoredCredentials();
  return credentials ? { kind: 'joined', credentials } : { kind: 'none' };
}

// ── API 呼び出し ─────────────────────────────────────────────────────────────

const KNOWN_CODES: readonly SyncErrorCode[] = [
  'INVITE_INVALID',
  'INVITE_EXPIRED',
  'GROUP_FULL',
  'RATE_LIMITED',
  'OWNER_ONLY',
];

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: SyncCredentials;
}

/**
 * 応答を SyncError へ写す共通処理。
 * - 503 SYNC_DISABLED → SYNC_UNAVAILABLE（サーバーが古い/DB 未接続。アプリは通常どおり動く）
 * - 401 → AUTH_INVALID（呼び出し側でクレデンシャル破棄を判断）
 * - ネットワーク断 → NETWORK
 */
async function request<T>(path: string, options: RequestOptions): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_V1}/sync${path}`, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.auth
          ? { Authorization: `Bearer ${options.auth.deviceId}.${options.auth.deviceSecret}` }
          : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new SyncError('NETWORK');
  }

  let json: { ok?: boolean; error?: string; data?: T } | null = null;
  try {
    json = (await res.json()) as { ok?: boolean; error?: string; data?: T };
  } catch {
    json = null;
  }

  if (res.ok && json?.ok) return json.data as T;

  const code = json?.error;
  if (code === 'SYNC_DISABLED') throw new SyncError('SYNC_UNAVAILABLE');
  if (res.status === 401) throw new SyncError('AUTH_INVALID');
  if (code && (KNOWN_CODES as readonly string[]).includes(code)) {
    throw new SyncError(code as SyncErrorCode);
  }
  // 400 だけが「この内容では受理されない」。502/504/HTML 応答（Railway の再デプロイ中）は
  // 一時障害なので区別する — ここを一緒くたにすると、送信待ちを捨ててよいかの判断ができない
  if (res.status === 400) throw new SyncError('SERVER_REJECTED');
  throw new SyncError('SERVER');
}

/**
 * 認証つき呼び出し。401 ならローカルの鍵を破棄して AUTH_INVALID を投げる
 * （グループが消えた・この端末が外された ＝ 持っていても意味の無い鍵を残さない）。
 */
async function authedRequest<T>(
  path: string,
  options: Omit<RequestOptions, 'auth'>,
  credentials: SyncCredentials,
): Promise<T> {
  try {
    return await request<T>(path, { ...options, auth: credentials });
  } catch (err) {
    if (err instanceof SyncError && err.code === 'AUTH_INVALID') await clearCredentials();
    throw err;
  }
}

/** グループ新設。発行されたクレデンシャルを secure-store に保存して返す */
export async function createSyncGroup(displayName: string | null): Promise<SyncGroupCreated> {
  if ((await getStoredCredentials()) !== null) throw new SyncError('ALREADY_JOINED');
  const data = await request<SyncGroupCreated>('/groups', {
    method: 'POST',
    body: displayName ? { displayName } : {},
  });
  await storeCredentials({
    groupId: data.groupId,
    deviceId: data.deviceId,
    deviceSecret: data.deviceSecret,
  });
  return data;
}

/** 招待コードで参加 */
export async function joinSyncGroup(
  inviteCode: string,
  displayName: string | null,
): Promise<SyncCredentials & { memberCount: number }> {
  if ((await getStoredCredentials()) !== null) throw new SyncError('ALREADY_JOINED');
  const data = await request<SyncCredentials & { memberCount: number }>('/groups/join', {
    method: 'POST',
    body: displayName ? { inviteCode, displayName } : { inviteCode },
  });
  await storeCredentials({
    groupId: data.groupId,
    deviceId: data.deviceId,
    deviceSecret: data.deviceSecret,
  });
  return data;
}

/**
 * 自分の状態（認証の疎通を兼ねる）。
 * 401（グループが消えた・この端末が外された）ならローカルのクレデンシャルを破棄して
 * AUTH_INVALID を投げる — 呼び出し側は「未参加」表示に戻れば自己修復する。
 */
export async function fetchSyncMe(): Promise<SyncMe> {
  const credentials = await getStoredCredentials();
  if (!credentials) throw new SyncError('AUTH_INVALID');
  try {
    return await request<SyncMe>('/me', { method: 'GET', auth: credentials });
  } catch (err) {
    if (err instanceof SyncError && err.code === 'AUTH_INVALID') await clearCredentials();
    throw err;
  }
}

/** 招待コードの再発行（オーナーのみ）。期限切れ・漏えい時のやり直し */
export async function rotateSyncInvite(): Promise<{ inviteCode: string; inviteExpiresAt: string }> {
  const credentials = await getStoredCredentials();
  if (!credentials) throw new SyncError('AUTH_INVALID');
  return request('/invite/rotate', { method: 'POST', body: {}, auth: credentials });
}

/**
 * グループから離脱。サーバー側の削除に成功してもしなくても（既に消えている＝401 でも）
 * ローカルのクレデンシャルは破棄する — 「抜けたのに端末に鍵が残る」を作らない。
 */
export async function leaveSyncGroup(): Promise<void> {
  const credentials = await getStoredCredentials();
  if (!credentials) return;
  try {
    await request('/devices/me', { method: 'DELETE', auth: credentials });
  } catch (err) {
    if (err instanceof SyncError && err.code === 'AUTH_INVALID') {
      await clearCredentials();
      return;
    }
    throw err;
  }
  await clearCredentials();
}

/**
 * グループ削除 ＝ サーバー側データの全消去（オーナーのみ）。
 * Play データセーフティの「データ削除手段」の入口。成功したらローカルの鍵も破棄。
 */
export async function deleteSyncGroup(): Promise<void> {
  const credentials = await getStoredCredentials();
  if (!credentials) throw new SyncError('AUTH_INVALID');
  try {
    await request('/group', { method: 'DELETE', body: { confirm: true }, auth: credentials });
  } catch (err) {
    if (err instanceof SyncError && err.code === 'AUTH_INVALID') {
      await clearCredentials();
      return;
    }
    throw err;
  }
  await clearCredentials();
}

// ── S1: push / pull（設計 §5-1b） ────────────────────────────────────────────

export interface SyncPushChange {
  entityType: string;
  entityId: string;
  /** null = tombstone（削除） */
  payload: string | null;
  clientUpdatedAt: string;
  deleted: boolean;
}

export interface SyncPullChange extends SyncPushChange {
  seq: number;
  /** この変更を書いた端末。自分の ID なら適用しない（押し返しの防止） */
  updatedByDevice: string;
}

export interface SyncPullResult {
  changes: SyncPullChange[];
  /** 数量デルタ（S2 で使う）。S1 では常に空 */
  deltas: unknown[];
  latestSeq: number;
  hasMore: boolean;
}

export interface SyncPushResult {
  /** サーバーが LWW で採用した件数。古くて捨てられた分は含まれない（エラーではない） */
  applied: number;
  latestSeq: number;
}

/** 変更をまとめて送る。呼び出し側はグループ参加済みであることを確かめてから呼ぶ */
export async function pushSyncChanges(changes: readonly SyncPushChange[]): Promise<SyncPushResult> {
  const credentials = await getStoredCredentials();
  if (!credentials) throw new SyncError('AUTH_INVALID');
  if (changes.length === 0) return { applied: 0, latestSeq: 0 };
  return authedRequest<SyncPushResult>('/push', { method: 'POST', body: { changes } }, credentials);
}

/** since より後の変更を取る。`hasMore` が立っていれば呼び出し側が繰り返す */
export async function pullSyncChanges(since: number, limit = 500): Promise<SyncPullResult> {
  const credentials = await getStoredCredentials();
  if (!credentials) throw new SyncError('AUTH_INVALID');
  return authedRequest<SyncPullResult>(
    `/pull?since=${encodeURIComponent(String(since))}&limit=${encodeURIComponent(String(limit))}`,
    { method: 'GET' },
    credentials,
  );
}

/**
 * Expo Push トークンの登録（変更通知の宛先）。
 *
 * 通知は**内容を持たない同期のきっかけ**でしかない（設計 §0-2 — 利用者名もデータ内容も
 * 載せない）。登録できなくても、起動時とフォアグラウンド復帰の pull で追いつく。
 *
 * `locale` は通知の文面（固定文）をどちらの言語で出すかだけに使う。個人情報ではない。
 */
export async function registerSyncPushToken(
  expoPushToken: string | null,
  locale?: 'ja' | 'en',
): Promise<void> {
  const credentials = await getStoredCredentials();
  if (!credentials) throw new SyncError('AUTH_INVALID');
  await authedRequest<unknown>(
    '/devices/me',
    { method: 'PATCH', body: locale ? { expoPushToken, locale } : { expoPushToken } },
    credentials,
  );
}
