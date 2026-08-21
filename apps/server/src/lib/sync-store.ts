/**
 * クラウド同期の永続化（PostgreSQL — docs/クラウド同期設計.md §3）。
 *
 * - `DATABASE_URL`（または `SYNC_DATABASE_URL`）が無ければ同期は**無効**。ルータが 503 を
 *   返すだけで、AI・Web共有など他の機能は今までどおり動く（サーバーと DB の追加が
 *   アプリ配布と別々に進んでも、片方だけで壊れない）
 * - スキーマは初回接続時に CREATE TABLE IF NOT EXISTS（share-store と同じ方針。
 *   `sync_entities.payload` は不透明な JSON 文字列 — サーバーは中身を解釈しないので、
 *   アプリ側のカラム追加でサーバー改修が要らない。通信の秘密の扱いにも整合）
 * - SQL は postgres.js のタグテンプレート経由のみ（文字列結合 SQL 禁止 — CLAUDE.md §5）。
 *   DDL だけは固定文字列を `unsafe` で流す（利用者入力は一切混ざらない）
 * - S0 ではグループ・端末・認証まで。entities / deltas のテーブルは先に作っておき、
 *   push/pull（S1）・数量デルタ（S2 — 設計 §5-1）はこの上に載せる
 */
import postgres, { type Sql } from 'postgres';

import {
  MAX_DEVICES_PER_GROUP,
  generateDeviceSecret,
  generateId,
  generateInviteCode,
  hashSecret,
  inviteExpiresAt,
  isInviteExpired,
  normalizeInviteCode,
  verifySecretHash,
} from './sync-auth.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sync_groups (
  id                TEXT PRIMARY KEY,
  invite_code       TEXT NOT NULL UNIQUE,
  invite_expires_at TIMESTAMPTZ NOT NULL,
  seq               BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_devices (
  id              TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES sync_groups(id) ON DELETE CASCADE,
  secret_hash     TEXT NOT NULL,
  display_name    TEXT,
  is_owner        BOOLEAN NOT NULL DEFAULT FALSE,
  expo_push_token TEXT,
  last_pull_seq   BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_devices_group ON sync_devices (group_id);
CREATE TABLE IF NOT EXISTS sync_entities (
  group_id          TEXT NOT NULL REFERENCES sync_groups(id) ON DELETE CASCADE,
  entity_type       TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  payload           TEXT NOT NULL,
  deleted_at        TIMESTAMPTZ,
  seq               BIGINT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL,
  updated_by_device TEXT NOT NULL,
  PRIMARY KEY (group_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_entities_pull ON sync_entities (group_id, seq);
CREATE TABLE IF NOT EXISTS sync_deltas (
  group_id    TEXT NOT NULL REFERENCES sync_groups(id) ON DELETE CASCADE,
  seq         BIGINT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  field       TEXT NOT NULL,
  delta       DOUBLE PRECISION NOT NULL,
  device_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, seq)
);
`;

function databaseUrl(): string | null {
  const raw = process.env['SYNC_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : null;
}

export function isSyncEnabled(): boolean {
  return databaseUrl() !== null;
}

let ready: Promise<Sql> | null = null;

async function db(): Promise<Sql> {
  if (ready === null) {
    const url = databaseUrl();
    if (url === null) throw new Error('sync store is disabled (no DATABASE_URL)');
    const sql = postgres(url, { max: 5, onnotice: () => undefined });
    ready = sql
      .unsafe(SCHEMA_SQL)
      .then(() => sql)
      .catch((err: unknown) => {
        ready = null;
        void sql.end({ timeout: 1 });
        throw err;
      });
  }
  return ready;
}

/** テスト用: 接続を閉じて初期化し直せるようにする */
export async function closeSyncStoreForTesting(): Promise<void> {
  if (ready === null) return;
  const sql = await ready.catch(() => null);
  ready = null;
  if (sql) await sql.end({ timeout: 1 });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

// ── 型 ───────────────────────────────────────────────────────────────────────

export interface DeviceCredentials {
  groupId: string;
  deviceId: string;
  /** 平文はこの応答にだけ現れる。サーバーはハッシュしか持たない */
  deviceSecret: string;
}

export interface GroupCreated extends DeviceCredentials {
  inviteCode: string;
  inviteExpiresAt: string;
}

export type JoinResult =
  | ({ kind: 'joined'; memberCount: number } & DeviceCredentials)
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'full' };

export interface AuthedDevice {
  deviceId: string;
  groupId: string;
  isOwner: boolean;
}

export interface GroupInfo {
  memberCount: number;
  inviteCode: string;
  inviteExpiresAt: string;
}

// ── 操作 ─────────────────────────────────────────────────────────────────────

/** グループ新設。作成した端末がオーナー（招待の再発行とグループ削除ができる） */
export async function createGroup(displayName: string | null): Promise<GroupCreated> {
  const sql = await db();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const groupId = generateId();
    const deviceId = generateId();
    const secret = generateDeviceSecret();
    const code = generateInviteCode();
    const expires = inviteExpiresAt();
    try {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO sync_groups (id, invite_code, invite_expires_at)
                 VALUES (${groupId}, ${code}, ${expires})`;
        await tx`INSERT INTO sync_devices (id, group_id, secret_hash, display_name, is_owner)
                 VALUES (${deviceId}, ${groupId}, ${hashSecret(secret)}, ${displayName}, TRUE)`;
      });
      return {
        groupId,
        deviceId,
        deviceSecret: secret,
        inviteCode: code,
        inviteExpiresAt: expires.toISOString(),
      };
    } catch (err) {
      // 招待コードの衝突（32^8 ≈ 1.1兆通りなので実質起きないが、UNIQUE で守って引き直す）
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  throw new Error('invite code collision (unreachable)');
}

/** 招待コードでグループに参加。定員チェックと挿入は同一トランザクション（競合で定員を超えない） */
export async function joinGroup(rawCode: string, displayName: string | null): Promise<JoinResult> {
  const sql = await db();
  const code = normalizeInviteCode(rawCode);
  const groups = await sql<{ id: string; invite_expires_at: Date }[]>`
    SELECT id, invite_expires_at FROM sync_groups WHERE invite_code = ${code}`;
  const group = groups[0];
  if (!group) return { kind: 'invalid' };
  if (isInviteExpired(group.invite_expires_at)) return { kind: 'expired' };

  return sql.begin(async (tx): Promise<JoinResult> => {
    const rows = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sync_devices WHERE group_id = ${group.id}`;
    const memberCount = Number(rows[0]?.count ?? '0');
    if (memberCount >= MAX_DEVICES_PER_GROUP) return { kind: 'full' };

    const deviceId = generateId();
    const secret = generateDeviceSecret();
    await tx`INSERT INTO sync_devices (id, group_id, secret_hash, display_name)
             VALUES (${deviceId}, ${group.id}, ${hashSecret(secret)}, ${displayName})`;
    return {
      kind: 'joined',
      groupId: group.id,
      deviceId,
      deviceSecret: secret,
      memberCount: memberCount + 1,
    };
  });
}

/** 端末 ID＋シークレットで認証。失敗は理由を区別せず null（列挙の手がかりを返さない） */
export async function authenticateDevice(
  deviceId: string,
  secret: string,
): Promise<AuthedDevice | null> {
  const sql = await db();
  const rows = await sql<
    { id: string; group_id: string; secret_hash: string; is_owner: boolean }[]
  >`
    SELECT id, group_id, secret_hash, is_owner FROM sync_devices WHERE id = ${deviceId}`;
  const row = rows[0];
  if (!row) return null;
  if (!verifySecretHash(secret, row.secret_hash)) return null;
  return { deviceId: row.id, groupId: row.group_id, isOwner: row.is_owner };
}

export async function getGroupInfo(groupId: string): Promise<GroupInfo | null> {
  const sql = await db();
  const rows = await sql<{ invite_code: string; invite_expires_at: Date; count: string }[]>`
    SELECT g.invite_code, g.invite_expires_at,
           (SELECT count(*)::text FROM sync_devices d WHERE d.group_id = g.id) AS count
    FROM sync_groups g WHERE g.id = ${groupId}`;
  const row = rows[0];
  if (!row) return null;
  return {
    memberCount: Number(row.count),
    inviteCode: row.invite_code,
    inviteExpiresAt: row.invite_expires_at.toISOString(),
  };
}

/** 招待コードの再発行（オーナーのみ — ルータ側で制御）。旧コードは即座に無効になる */
export async function rotateInvite(
  groupId: string,
): Promise<{ inviteCode: string; inviteExpiresAt: string }> {
  const sql = await db();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateInviteCode();
    const expires = inviteExpiresAt();
    try {
      await sql`UPDATE sync_groups SET invite_code = ${code}, invite_expires_at = ${expires}
                WHERE id = ${groupId}`;
      return { inviteCode: code, inviteExpiresAt: expires.toISOString() };
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  throw new Error('invite code collision (unreachable)');
}

/**
 * グループから離脱（自分の端末行を消す）。
 * 最後の 1 台が抜けたらグループごと消す（誰の物でもないデータを残さない）。
 * オーナーが抜けたら最古の残存端末をオーナーに昇格する。
 */
export async function leaveGroup(device: AuthedDevice): Promise<void> {
  const sql = await db();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM sync_devices WHERE id = ${device.deviceId}`;
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM sync_devices WHERE group_id = ${device.groupId}
      ORDER BY created_at ASC LIMIT 1`;
    const oldest = rows[0];
    if (!oldest) {
      await tx`DELETE FROM sync_groups WHERE id = ${device.groupId}`;
      return;
    }
    if (device.isOwner) {
      await tx`UPDATE sync_devices SET is_owner = TRUE WHERE id = ${oldest.id}`;
    }
  });
}

/**
 * グループ削除 ＝ サーバー側データの全消去（ON DELETE CASCADE で端末・entities・deltas も消える）。
 * Play データセーフティの「データ削除手段の提供」の実体（設計 §10）。
 */
export async function deleteGroup(groupId: string): Promise<void> {
  const sql = await db();
  await sql`DELETE FROM sync_groups WHERE id = ${groupId}`;
}
