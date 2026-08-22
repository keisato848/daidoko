/**
 * クラウド同期 API（S0: グループ・端末・認証 — docs/クラウド同期設計.md §2）。
 *
 * - DATABASE_URL が無い環境では全エンドポイントが 503 SYNC_DISABLED（他機能は無影響）
 * - 認証は `Authorization: Bearer <deviceId>.<secret>`。アカウントは無い
 * - グループ作成・参加はコスト/総当たりガードの日次レート制限つき（share と同じ in-memory 方式）
 * - push/pull（S1）・数量デルタ（S2）はこのルータに追記する
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import { parseAuthHeader } from '../lib/sync-auth.js';
import {
  authenticateDevice,
  createGroup,
  deleteGroup,
  getGroupInfo,
  getOtherDevicePushTargets,
  isSyncEnabled,
  joinGroup,
  leaveGroup,
  pullChanges,
  pushChanges,
  rotateInvite,
  setDevicePushToken,
  type AuthedDevice,
} from '../lib/sync-store.js';

// ── レート制限（sync 専用・in-memory・24h 窓 — share と同じ方式） ────────────
const WINDOW_MS = 24 * 60 * 60 * 1000;
const syncBuckets = new Map<string, { count: number; resetAt: number }>();

function syncLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function takeSyncRateLimit(kind: 'create' | 'join', clientKey: string): boolean {
  const now = Date.now();
  const take = (key: string, limit: number): boolean => {
    if (limit <= 0) return true; // 0 = 無効
    const existing = syncBuckets.get(key);
    const bucket =
      !existing || now >= existing.resetAt ? { count: 0, resetAt: now + WINDOW_MS } : existing;
    syncBuckets.set(key, bucket);
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  };
  if (kind === 'create') {
    // グループ新設は 1 人あたり数回で足りる。緩めに置きつつ総量も抑える
    if (!take('create:__global__', syncLimit('SYNC_CREATE_GLOBAL_DAILY_LIMIT', 200))) return false;
    return take(`create:${clientKey}`, syncLimit('SYNC_CREATE_DAILY_LIMIT', 10));
  }
  // 参加試行は招待コード総当たりのガード（32^8 ≈ 1.1兆 × 24h 期限 × この上限）
  if (!take('join:__global__', syncLimit('SYNC_JOIN_GLOBAL_DAILY_LIMIT', 1000))) return false;
  return take(`join:${clientKey}`, syncLimit('SYNC_JOIN_DAILY_LIMIT', 50));
}

export function resetSyncRateLimitForTesting(): void {
  syncBuckets.clear();
}

function clientKeyOf(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'anonymous'
  );
}

// ── ルータ ───────────────────────────────────────────────────────────────────

type SyncEnv = { Variables: { device: AuthedDevice } };

const syncRouter = new Hono<SyncEnv>();

syncRouter.use('*', async (c, next) => {
  if (!isSyncEnabled()) return c.json({ ok: false, error: 'SYNC_DISABLED' }, 503);
  await next();
});

/** Bearer 認証。失敗理由は区別しない（端末 ID の存在を推測させない） */
const requireDevice = createMiddleware<SyncEnv>(async (c, next) => {
  const parsed = parseAuthHeader(c.req.header('authorization'));
  if (!parsed) return c.json({ ok: false, error: 'AUTH_REQUIRED' }, 401);
  const device = await authenticateDevice(parsed.deviceId, parsed.secret);
  if (!device) return c.json({ ok: false, error: 'AUTH_INVALID' }, 401);
  c.set('device', device);
  await next();
});

const displayNameSchema = z
  .string()
  .trim()
  .max(30)
  .transform((v) => (v === '' ? null : v));

const createGroupSchema = z.object({
  displayName: displayNameSchema.optional(),
});

const joinGroupSchema = z.object({
  inviteCode: z.string().trim().min(4).max(16),
  displayName: displayNameSchema.optional(),
});

/** グループ新設 → 端末クレデンシャルと招待コードを返す（シークレットはこの応答限り） */
syncRouter.post('/groups', zValidator('json', createGroupSchema), async (c) => {
  if (!takeSyncRateLimit('create', clientKeyOf(c.req.raw.headers))) {
    return c.json({ ok: false, error: 'RATE_LIMITED' }, 429);
  }
  const body = c.req.valid('json');
  const created = await createGroup(body.displayName ?? null);
  return c.json({ ok: true, data: created }, 201);
});

/** 招待コードで参加 */
syncRouter.post('/groups/join', zValidator('json', joinGroupSchema), async (c) => {
  if (!takeSyncRateLimit('join', clientKeyOf(c.req.raw.headers))) {
    return c.json({ ok: false, error: 'RATE_LIMITED' }, 429);
  }
  const body = c.req.valid('json');
  const result = await joinGroup(body.inviteCode, body.displayName ?? null);
  switch (result.kind) {
    case 'invalid':
      return c.json({ ok: false, error: 'INVITE_INVALID' }, 404);
    case 'expired':
      return c.json({ ok: false, error: 'INVITE_EXPIRED' }, 410);
    case 'full':
      return c.json({ ok: false, error: 'GROUP_FULL' }, 409);
    case 'joined':
      return c.json({
        ok: true,
        data: {
          groupId: result.groupId,
          deviceId: result.deviceId,
          deviceSecret: result.deviceSecret,
          memberCount: result.memberCount,
        },
      });
  }
});

/** 自分の状態（認証の疎通確認を兼ねる）。招待コードはオーナーにだけ返す */
syncRouter.get('/me', requireDevice, async (c) => {
  const device = c.get('device');
  const info = await getGroupInfo(device.groupId);
  if (!info) return c.json({ ok: false, error: 'AUTH_INVALID' }, 401);
  return c.json({
    ok: true,
    data: {
      groupId: device.groupId,
      deviceId: device.deviceId,
      isOwner: device.isOwner,
      memberCount: info.memberCount,
      ...(device.isOwner
        ? { inviteCode: info.inviteCode, inviteExpiresAt: info.inviteExpiresAt }
        : {}),
    },
  });
});

/** 招待コードの再発行（オーナーのみ）。旧コードは即無効 */
syncRouter.post('/invite/rotate', requireDevice, async (c) => {
  const device = c.get('device');
  if (!device.isOwner) return c.json({ ok: false, error: 'OWNER_ONLY' }, 403);
  const rotated = await rotateInvite(device.groupId);
  return c.json({ ok: true, data: rotated });
});

/** グループ離脱（自分の端末を外す）。最後の 1 台ならグループごと消える */
syncRouter.delete('/devices/me', requireDevice, async (c) => {
  await leaveGroup(c.get('device'));
  return c.json({ ok: true });
});

const deleteGroupSchema = z.object({ confirm: z.literal(true) });

/**
 * グループ削除 ＝ サーバー側データの全消去（オーナーのみ・confirm 必須）。
 * Play データセーフティの「データ削除手段」の実体（設計 §10）。
 */
syncRouter.delete('/group', requireDevice, zValidator('json', deleteGroupSchema), async (c) => {
  const device = c.get('device');
  if (!device.isOwner) return c.json({ ok: false, error: 'OWNER_ONLY' }, 403);
  await deleteGroup(device.groupId);
  return c.json({ ok: true });
});

// ── S1: push / pull（設計 §5-1b） ────────────────────────────────────────────

/** payload はレシピ丸ごと（材料・手順込み）を想定 — 余裕を見て 300KB で弾く */
const MAX_PAYLOAD_CHARS = 300_000;
const MAX_CHANGES_PER_PUSH = 200;

const pushSchema = z.object({
  changes: z
    .array(
      z.object({
        entityType: z.string().min(1).max(40),
        entityId: z.string().min(1).max(64),
        payload: z.string().max(MAX_PAYLOAD_CHARS).nullable(),
        clientUpdatedAt: z.string().datetime({ offset: true }),
        deleted: z.boolean(),
      }),
    )
    .min(1)
    .max(MAX_CHANGES_PER_PUSH),
});

/**
 * 変更通知の文面。**固定文しか無い**（§0-2 の判定）。
 * 利用者名も件数も種別も入れない — 内容を運んだ時点で「他人の情報を媒介して伝える」側に寄る。
 */
export const SYNC_NOTIFICATION_TEXT = {
  ja: { title: 'だいどこ', body: '家族の共有データが更新されました' },
  en: { title: 'DAIDOKO', body: 'Your family library was updated' },
} as const;

export function notificationTextFor(locale: string | null): { title: string; body: string } {
  return locale === 'en' ? SYNC_NOTIFICATION_TEXT.en : SYNC_NOTIFICATION_TEXT.ja;
}

/**
 * 通知のデバウンス（グループ単位）。
 *
 * 通知は同期のきっかけでしかないので、続けて何度も鳴らす意味が無い。
 * 5 分に 1 回までに絞る（設計 §7）。この窓で落ちた通知の分は、次に相手が
 * アプリを開いたときの pull で必ず追いつく。
 */
const NOTIFY_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * 買い物リスト・在庫を含む変更は**もっと短い窓**にする（設計 §5-2b）。
 * 「片方が買ったら伝わる」が買い物リストの価値そのもので、5 分待たせると意味が無い。
 * 通知の中身は変えない（固定文のまま — §0-2）。
 */
const NOTIFY_DEBOUNCE_URGENT_MS = 60 * 1000;

/** この種別が含まれる push は急ぎ扱い（買い物中に効くもの） */
const URGENT_ENTITY_TYPES = new Set(['shopping_item', 'pantry_item']);

export function isUrgentChange(entityTypes: readonly string[]): boolean {
  return entityTypes.some((type) => URGENT_ENTITY_TYPES.has(type));
}

const lastNotifiedAt = new Map<string, number>();

export function takeNotifySlot(groupId: string, now = Date.now(), urgent = false): boolean {
  const window = urgent ? NOTIFY_DEBOUNCE_URGENT_MS : NOTIFY_DEBOUNCE_MS;
  const last = lastNotifiedAt.get(groupId);
  if (last !== undefined && now - last < window) return false;
  lastNotifiedAt.set(groupId, now);
  return true;
}

export function resetSyncNotifyDebounceForTesting(): void {
  lastNotifiedAt.clear();
}

/**
 * 変更を受けたら同グループの他端末へ Expo Push（**内容を持たない同期トリガー** —
 * 文言に利用者名・データ内容を含めない。§0-2 の該当性判定）。ベストエフォートで
 * 失敗は握る — 通知が落ちても次回起動時の pull で追いつく。
 */
async function notifyGroupDevices(device: AuthedDevice, urgent: boolean): Promise<void> {
  try {
    if (!takeNotifySlot(device.groupId, Date.now(), urgent)) return;
    const targets = await getOtherDevicePushTargets(device);
    if (targets.length === 0) return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        targets.map((target) => ({
          to: target.token,
          ...notificationTextFor(target.locale),
          data: { type: 'sync' },
        })),
      ),
    });
  } catch {
    // ベストエフォート
  }
}

syncRouter.post('/push', requireDevice, zValidator('json', pushSchema), async (c) => {
  const device = c.get('device');
  const { changes } = c.req.valid('json');
  const result = await pushChanges(device, changes);
  if (result.applied > 0) {
    void notifyGroupDevices(device, isUrgentChange(changes.map((change) => change.entityType)));
  }
  return c.json({ ok: true, data: result });
});

syncRouter.get('/pull', requireDevice, async (c) => {
  const device = c.get('device');
  const since = Number(c.req.query('since') ?? '0');
  const rawLimit = Number(c.req.query('limit') ?? '500');
  if (!Number.isInteger(since) || since < 0) {
    return c.json({ ok: false, error: 'BAD_REQUEST' }, 400);
  }
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 500;
  const result = await pullChanges(device, since, limit);
  return c.json({ ok: true, data: result });
});

const deviceUpdateSchema = z.object({
  expoPushToken: z.string().max(200).nullable().optional(),
  /** 通知の文面の言語だけに使う。他の用途には持たない */
  locale: z.enum(['ja', 'en']).optional(),
});

/** 端末情報の更新（push トークンと、通知文面の言語） */
syncRouter.patch(
  '/devices/me',
  requireDevice,
  zValidator('json', deviceUpdateSchema),
  async (c) => {
    const device = c.get('device');
    const body = c.req.valid('json');
    if (body.expoPushToken !== undefined) {
      await setDevicePushToken(device, body.expoPushToken, body.locale ?? null);
    }
    return c.json({ ok: true });
  },
);

export default syncRouter;
