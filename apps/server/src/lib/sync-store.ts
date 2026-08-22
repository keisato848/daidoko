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
  lwwIncomingWins,
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
  is_owner        BOOLEAN NOT NULL DEFAULT FALSE,
  expo_push_token TEXT,
  last_pull_seq   BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 通知の文面をどちらの言語で出すかだけに使う（'ja' | 'en'）。後から足した列
ALTER TABLE sync_devices ADD COLUMN IF NOT EXISTS locale TEXT;
-- 端末の表示名は**保存しない**（設計 §2 — サーバーに個人情報を置かない）。
-- 読み書きする経路はもう無いので、既存の値ごと落とす
ALTER TABLE sync_devices DROP COLUMN IF EXISTS display_name;
-- 最後に pull した時刻（#209）。休眠端末の整理と、オーナー不在時の所有権の引き継ぎに使う。
-- 時刻しか持たない（何をしたかは記録しない）
ALTER TABLE sync_devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
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
  /** グループの端末（個人情報は持たない — id・役割・最終同期時刻だけ） */
  devices: DeviceSummary[];
}

export interface DeviceSummary {
  id: string;
  isOwner: boolean;
  /** 最後に同期した時刻。一度も pull していなければ登録時刻 */
  lastSeenAt: string;
}

/**
 * 休眠の判定（#209）。
 *
 * - **オーナーが 14 日**同期していなければ、所有権を最も古い生存端末へ移す。
 *   端末の紛失・初期化で二度と戻らないオーナーを待ち続けると、招待の再発行も
 *   グループ削除もできなくなる（＝データ削除手段の約束が果たせない）
 * - **90 日**同期していない端末は、誰かが参加・離脱・状態確認したときに消す。
 *   消された端末はもう一度招待コードで入り直せば全データが戻る（§2-2）
 *
 * どちらも「誰かの操作のついで」に行う（cron を持たない）。
 */
export const OWNER_STALE_DAYS = 14;
export const DEVICE_STALE_DAYS = 90;

// ── 操作 ─────────────────────────────────────────────────────────────────────

/** グループ新設。作成した端末がオーナー（招待の再発行とグループ削除ができる） */
export async function createGroup(): Promise<GroupCreated> {
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
        await tx`INSERT INTO sync_devices (id, group_id, secret_hash, is_owner)
                 VALUES (${deviceId}, ${groupId}, ${hashSecret(secret)}, TRUE)`;
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

/**
 * 招待コードでグループに参加。
 *
 * 定員チェックと挿入は同一トランザクションで、**先にグループ行をロックする**。
 * ロック無しの `count(*)` は READ COMMITTED では競合を防げない（2 台が同時に
 * 9 を読んで 2 台とも入り、定員を超える）。
 */
export async function joinGroup(rawCode: string): Promise<JoinResult> {
  const sql = await db();
  const code = normalizeInviteCode(rawCode);
  const groups = await sql<{ id: string; invite_expires_at: Date }[]>`
    SELECT id, invite_expires_at FROM sync_groups WHERE invite_code = ${code}`;
  const group = groups[0];
  if (!group) return { kind: 'invalid' };
  if (isInviteExpired(group.invite_expires_at)) return { kind: 'expired' };

  // 幽霊の端末行が定員を食わないよう、参加の前に休眠端末を整理する（#209）
  await reapStaleDevices(group.id, null);

  return sql.begin(async (tx): Promise<JoinResult> => {
    await tx`SELECT id FROM sync_groups WHERE id = ${group.id} FOR UPDATE`;
    const rows = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sync_devices WHERE group_id = ${group.id}`;
    const memberCount = Number(rows[0]?.count ?? '0');
    if (memberCount >= MAX_DEVICES_PER_GROUP) return { kind: 'full' };

    const deviceId = generateId();
    const secret = generateDeviceSecret();
    await tx`INSERT INTO sync_devices (id, group_id, secret_hash)
             VALUES (${deviceId}, ${group.id}, ${hashSecret(secret)})`;
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

/**
 * 休眠端末の整理と所有権の引き継ぎ（#209）。参加・離脱・状態確認のついでに呼ぶ。
 *
 * `keepDeviceId` はいま操作している端末（自分を休眠として消さない — 長く開いていなくても
 * いま開いた時点で生きている）。
 */
export async function reapStaleDevices(
  groupId: string,
  keepDeviceId: string | null,
): Promise<void> {
  const sql = await db();
  await sql.begin(async (tx) => {
    await tx`SELECT id FROM sync_groups WHERE id = ${groupId} FOR UPDATE`;
    if (keepDeviceId) {
      await tx`UPDATE sync_devices SET last_seen_at = now() WHERE id = ${keepDeviceId}`;
    }
    // 1. 90 日休眠の端末を消す（自分以外）
    await tx`
      DELETE FROM sync_devices
      WHERE group_id = ${groupId}
        AND id <> ${keepDeviceId ?? ''}
        AND COALESCE(last_seen_at, created_at) < now() - make_interval(days => ${DEVICE_STALE_DAYS})`;
    // 2. オーナーが居ない、または 14 日休眠なら、最も古い生存端末へ移す
    const owners = await tx<{ id: string; stale: boolean }[]>`
      SELECT id,
             (COALESCE(last_seen_at, created_at) < now() - make_interval(days => ${OWNER_STALE_DAYS})) AS stale
      FROM sync_devices WHERE group_id = ${groupId} AND is_owner = TRUE`;
    const owner = owners[0];
    if (owner && !owner.stale) return;
    const candidates = await tx<{ id: string }[]>`
      SELECT id FROM sync_devices
      WHERE group_id = ${groupId}
        AND COALESCE(last_seen_at, created_at) >= now() - make_interval(days => ${OWNER_STALE_DAYS})
      ORDER BY created_at ASC LIMIT 1`;
    const next = candidates[0];
    if (!next || next.id === owner?.id) return;
    await tx`UPDATE sync_devices SET is_owner = FALSE WHERE group_id = ${groupId}`;
    await tx`UPDATE sync_devices SET is_owner = TRUE WHERE id = ${next.id}`;
  });
}

export async function getGroupInfo(groupId: string): Promise<GroupInfo | null> {
  const sql = await db();
  const rows = await sql<{ invite_code: string; invite_expires_at: Date }[]>`
    SELECT invite_code, invite_expires_at FROM sync_groups WHERE id = ${groupId}`;
  const row = rows[0];
  if (!row) return null;
  const devices = await sql<{ id: string; is_owner: boolean; seen: Date }[]>`
    SELECT id, is_owner, COALESCE(last_seen_at, created_at) AS seen
    FROM sync_devices WHERE group_id = ${groupId} ORDER BY created_at ASC`;
  return {
    memberCount: devices.length,
    inviteCode: row.invite_code,
    inviteExpiresAt: row.invite_expires_at.toISOString(),
    devices: devices.map((d) => ({
      id: d.id,
      isOwner: d.is_owner,
      lastSeenAt: d.seen.toISOString(),
    })),
  };
}

/**
 * オーナーが他の端末を外す（設計 §2-2 の `DELETE /sync/devices/:id`）。
 * 外された端末は次の通信で 401 になり、未参加に戻る。招待コードは呼び出し側で
 * 回すこと（外した端末が同じコードで入り直せないように）。
 */
export async function evictDevice(owner: AuthedDevice, deviceId: string): Promise<boolean> {
  if (deviceId === owner.deviceId) return false;
  const sql = await db();
  const rows = await sql<{ id: string }[]>`
    DELETE FROM sync_devices WHERE id = ${deviceId} AND group_id = ${owner.groupId} RETURNING id`;
  return rows.length > 0;
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

// ── S1: push / pull（設計 §5-1b） ────────────────────────────────────────────

export interface PushChange {
  entityType: string;
  entityId: string;
  /** 不透明な JSON 文字列。サーバーは解釈しない（削除 tombstone は null 可） */
  payload: string | null;
  clientUpdatedAt: string;
  deleted: boolean;
}

export interface PullChange extends PushChange {
  seq: number;
  updatedByDevice: string;
}

export interface PullDelta {
  seq: number;
  entityType: string;
  entityId: string;
  field: string;
  delta: number;
  deviceId: string;
}

export interface PushResult {
  applied: number;
  latestSeq: number;
}

export interface PullResult {
  changes: PullChange[];
  deltas: PullDelta[];
  latestSeq: number;
  hasMore: boolean;
}

/**
 * 端末の時計が進んでいても受け付ける上限（分）。
 *
 * LWW は端末の時計を基準にするので、**1 台の狂った時計がそのエンティティを永久に凍らせる**。
 * 2099 年の `clientUpdatedAt` を一度受け付けると、以後どの端末のまともな編集も負けて捨てられ、
 * 家族の誰も直せなくなる。ここで頭を押さえておけば、遅れて来た正しい編集がいずれ勝つ。
 * 「少し進んでいる」程度は正常（端末間の時計はふつうにずれる）なので、余裕を持たせる。
 */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function clampClientUpdatedAt(iso: string, now: number): Date {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return new Date(now);
  return new Date(Math.min(parsed, now + MAX_CLOCK_SKEW_MS));
}

/**
 * 変更の一括受け取り。LWW で採用分だけに seq を採番して保存する。
 * 全体を 1 トランザクションで行う（seq の穴・順序乱れを作らない）。
 */
export async function pushChanges(
  device: AuthedDevice,
  changes: readonly PushChange[],
): Promise<PushResult> {
  const sql = await db();
  const now = Date.now();
  return sql.begin(async (tx) => {
    // **先にグループ行をロックして、push を直列化する。** READ COMMITTED では下の
    // 「既存行を読んで LWW を判定する」SELECT に行ロックが無く、2 台が同じ品目を同時に
    // 押すと、先にコミットした新しい方を、古い判定のまま後から来た方が踏み潰す
    // （踏み潰された端末は 200 を受けて待ち行列から消しているので二度と送らない）。
    // join が定員チェックでやっているのと同じ構え。バッチの 2 件目以降は seq の
    // 採番で同じロックを取るので、競合の窓は 1 件目だけだった
    await tx`SELECT id FROM sync_groups WHERE id = ${device.groupId} FOR UPDATE`;
    let applied = 0;
    for (const change of changes) {
      const rows = await tx<{ updated_at: Date; updated_by_device: string }[]>`
        SELECT updated_at, updated_by_device FROM sync_entities
        WHERE group_id = ${device.groupId}
          AND entity_type = ${change.entityType} AND entity_id = ${change.entityId}`;
      const existing = rows[0];
      const clientUpdatedAt = clampClientUpdatedAt(change.clientUpdatedAt, now);
      if (
        existing &&
        !lwwIncomingWins(
          clientUpdatedAt.toISOString(),
          device.deviceId,
          existing.updated_at.toISOString(),
          existing.updated_by_device,
        )
      ) {
        // 既存の方が新しい — この変更は採用しない。
        //
        // **ただし黙って捨てない。** 1 エンティティ 1 行なので、勝者の seq は動かないまま。
        // 送ってきた端末のカーソルがすでにその seq を越えていると、**勝者が二度と降りてこず**
        // 自分の負けた版を永久に表示し続ける（サーバーは再送のきっかけを持たない）。
        // seq だけ採り直して「新しい変更」に見せれば、次の pull で正しい版が届いて収束する。
        // payload・updated_at・updated_by_device は勝者のまま触らない。
        const bumpRows = await tx<{ seq: string }[]>`
          UPDATE sync_groups SET seq = seq + 1 WHERE id = ${device.groupId} RETURNING seq::text`;
        const bumped = Number(bumpRows[0]?.seq ?? '0');
        await tx`
          UPDATE sync_entities SET seq = ${bumped}
          WHERE group_id = ${device.groupId}
            AND entity_type = ${change.entityType} AND entity_id = ${change.entityId}`;
        continue;
      }
      const seqRows = await tx<{ seq: string }[]>`
        UPDATE sync_groups SET seq = seq + 1 WHERE id = ${device.groupId} RETURNING seq::text`;
      const seq = Number(seqRows[0]?.seq ?? '0');
      const deletedAt = change.deleted ? new Date() : null;
      await tx`
        INSERT INTO sync_entities
          (group_id, entity_type, entity_id, payload, deleted_at, seq, updated_at, updated_by_device)
        VALUES
          (${device.groupId}, ${change.entityType}, ${change.entityId}, ${change.payload ?? ''},
           ${deletedAt}, ${seq}, ${clientUpdatedAt}, ${device.deviceId})
        ON CONFLICT (group_id, entity_type, entity_id) DO UPDATE SET
          payload = EXCLUDED.payload,
          deleted_at = EXCLUDED.deleted_at,
          seq = EXCLUDED.seq,
          updated_at = EXCLUDED.updated_at,
          updated_by_device = EXCLUDED.updated_by_device`;
      applied += 1;
    }
    const latest = await tx<{ seq: string }[]>`
      SELECT seq::text FROM sync_groups WHERE id = ${device.groupId}`;
    return { applied, latestSeq: Number(latest[0]?.seq ?? '0') };
  });
}

/** since 以降の変更を seq 順で返す。呼び出し端末の last_pull_seq も進める（到達記録） */
export async function pullChanges(
  device: AuthedDevice,
  since: number,
  limit: number,
): Promise<PullResult> {
  const sql = await db();
  const rows = await sql<
    {
      entity_type: string;
      entity_id: string;
      payload: string;
      deleted_at: Date | null;
      seq: string;
      updated_at: Date;
      updated_by_device: string;
    }[]
  >`
    SELECT entity_type, entity_id, payload, deleted_at, seq::text, updated_at, updated_by_device
    FROM sync_entities
    WHERE group_id = ${device.groupId} AND seq > ${since}
    ORDER BY seq ASC LIMIT ${limit + 1}`;
  const deltaRows = await sql<
    {
      seq: string;
      entity_type: string;
      entity_id: string;
      field: string;
      delta: number;
      device_id: string;
    }[]
  >`
    SELECT seq::text, entity_type, entity_id, field, delta, device_id
    FROM sync_deltas
    WHERE group_id = ${device.groupId} AND seq > ${since}
    ORDER BY seq ASC LIMIT ${limit + 1}`;

  const hasMore = rows.length > limit || deltaRows.length > limit;
  const changes = rows.slice(0, limit).map((r) => ({
    entityType: r.entity_type,
    entityId: r.entity_id,
    payload: r.deleted_at ? null : r.payload,
    deleted: r.deleted_at !== null,
    clientUpdatedAt: r.updated_at.toISOString(),
    seq: Number(r.seq),
    updatedByDevice: r.updated_by_device,
  }));
  const deltas = deltaRows.slice(0, limit).map((r) => ({
    seq: Number(r.seq),
    entityType: r.entity_type,
    entityId: r.entity_id,
    field: r.field,
    delta: r.delta,
    deviceId: r.device_id,
  }));

  const latest = await sql<{ seq: string }[]>`
    SELECT seq::text FROM sync_groups WHERE id = ${device.groupId}`;
  // 到達記録は**実際に届けた**最大 seq。要求された `since` を書くと 1 ページ分ずれる
  //（いまは読み手が無いが、将来の保持期間・休眠端末の判定がこの値を見る）
  const delivered = Math.max(since, ...changes.map((chg) => chg.seq), ...deltas.map((d) => d.seq));
  await sql`UPDATE sync_devices SET last_pull_seq = ${delivered}, last_seen_at = now()
            WHERE id = ${device.deviceId}`;
  return { changes, deltas, latestSeq: Number(latest[0]?.seq ?? '0'), hasMore };
}

/** Expo Push トークンの登録（無ければ通知は飛ばないだけ — ベストエフォート） */
export async function setDevicePushToken(
  device: AuthedDevice,
  expoPushToken: string | null,
  locale?: string | null,
): Promise<void> {
  const sql = await db();
  if (locale === undefined) {
    await sql`UPDATE sync_devices SET expo_push_token = ${expoPushToken}
              WHERE id = ${device.deviceId}`;
    return;
  }
  await sql`UPDATE sync_devices SET expo_push_token = ${expoPushToken}, locale = ${locale}
            WHERE id = ${device.deviceId}`;
}

export interface PushTarget {
  token: string;
  /** 'ja' | 'en' | null（未登録）。**文面の言語を選ぶためだけ**に使う */
  locale: string | null;
}

/** 同グループの他端末の push 宛先（変更通知の宛先） */
/**
 * Expo が「もう届かない」と言ったトークンを消す（#207）。
 * 消さないと、機種変更やアンインストールで死んだトークンが通知のたびに送られ続ける。
 */
export async function clearDeadPushTokens(tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) return;
  const sql = await db();
  await sql`UPDATE sync_devices SET expo_push_token = NULL
            WHERE expo_push_token IN ${sql([...tokens])}`;
}

export async function getOtherDevicePushTargets(device: AuthedDevice): Promise<PushTarget[]> {
  const sql = await db();
  const rows = await sql<{ expo_push_token: string | null; locale: string | null }[]>`
    SELECT expo_push_token, locale FROM sync_devices
    WHERE group_id = ${device.groupId} AND id != ${device.deviceId}`;
  return rows
    .filter((r): r is { expo_push_token: string; locale: string | null } => !!r.expo_push_token)
    .map((r) => ({ token: r.expo_push_token, locale: r.locale }));
}
