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
  clearDeadPushTokens,
  createGroup,
  deleteGroup,
  evictDevice,
  getGroupInfo,
  isTypeAllowedForScope,
  listDeviceGroups,
  reapStaleDevices,
  getOtherDevicePushTargets,
  isSyncEnabled,
  joinGroup,
  leaveGroup,
  pullChanges,
  pushChanges,
  rotateInvite,
  setDevicePushToken,
  updateGroup,
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

/**
 * 期限切れのバケツを掃く。
 *
 * 上書きされるのは同じ鍵が再来したときだけなので、掃かないと 1 日あたり数百〜数千の鍵が
 * プロセスの寿命ぶん積み上がる。書き込みのたびに軽く掃除する。
 */
function sweepSyncBuckets(now: number): void {
  if (syncBuckets.size < 1000) return; // 小さいうちは走査そのものが無駄
  for (const [key, bucket] of syncBuckets) {
    if (now >= bucket.resetAt) syncBuckets.delete(key);
  }
}

function takeSyncRateLimit(kind: 'create' | 'join' | 'push', clientKey: string, cost = 1): boolean {
  const now = Date.now();
  sweepSyncBuckets(now);
  const take = (key: string, limit: number, amount = 1): boolean => {
    if (limit <= 0) return true; // 0 = 無効
    const existing = syncBuckets.get(key);
    const bucket =
      !existing || now >= existing.resetAt ? { count: 0, resetAt: now + WINDOW_MS } : existing;
    syncBuckets.set(key, bucket);
    if (bucket.count + amount > limit) return false;
    bucket.count += amount;
    return true;
  };
  if (kind === 'push') {
    // 送信は端末ごとに抑える。**全体枠は置かない** — 置くと 1 台の暴走で
    // 世界中の同期が止まる（下の create/join の反省）
    return take(`push:${clientKey}`, syncLimit('SYNC_PUSH_DAILY_LIMIT', 20000), cost);
  }
  if (kind === 'create') {
    // グループ新設は 1 人あたり数回で足りる。
    // **端末ごとの枠を先に取る。** 全体枠を先に取ると、誰か 1 人が全体枠を使い切った時点で
    // 正規の利用者も作れなくなる（＝自己 DoS）。端末枠で弾かれた分は全体枠を消費しない
    if (!take(`create:${clientKey}`, syncLimit('SYNC_CREATE_DAILY_LIMIT', 10))) return false;
    return take('create:__global__', syncLimit('SYNC_CREATE_GLOBAL_DAILY_LIMIT', 200));
  }
  // 参加試行は招待コード総当たりのガード（32^8 ≈ 1.1兆 × 24h 期限 × この上限）
  if (!take(`join:${clientKey}`, syncLimit('SYNC_JOIN_DAILY_LIMIT', 50))) return false;
  return take('join:__global__', syncLimit('SYNC_JOIN_GLOBAL_DAILY_LIMIT', 1000));
}

export function resetSyncRateLimitForTesting(): void {
  syncBuckets.clear();
}

/**
 * レート制限の鍵になる呼び出し元。
 *
 * **`X-Forwarded-For` の *最後* を見る。** 先頭は呼び出し側が自由に書ける（好きな値を
 * 入れれば毎回別人になり、端末ごとの上限が意味を失う）。信頼できるのは自分の直前の
 * プロキシが**追記した末尾**だけ。Railway もこの形で実 IP を足す。
 */
function clientKeyOf(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const last = forwarded?.split(',').at(-1)?.trim();
  return last || headers.get('x-real-ip') || 'anonymous';
}

// ── ルータ ───────────────────────────────────────────────────────────────────

type SyncEnv = { Variables: { device: AuthedDevice } };

const syncRouter = new Hono<SyncEnv>();

syncRouter.use('*', async (c, next) => {
  if (!isSyncEnabled()) return c.json({ ok: false, error: 'SYNC_DISABLED' }, 503);
  await next();
});

/**
 * Bearer 認証。失敗理由は区別しない（端末 ID の存在を推測させない）。
 *
 * 操作対象グループは `x-sync-group` ヘッダで指定する（§12-2）。省略時は端末の
 * 主グループ（1.13.0 以前のクライアント — 挙動不変）。membership の無いグループを
 * 指定しても AUTH_INVALID（グループの存在を漏らさない）。
 */
const requireDevice = createMiddleware<SyncEnv>(async (c, next) => {
  const parsed = parseAuthHeader(c.req.header('authorization'));
  if (!parsed) return c.json({ ok: false, error: 'AUTH_REQUIRED' }, 401);
  const requestedGroup = c.req.header('x-sync-group')?.trim() || null;
  const device = await authenticateDevice(parsed.deviceId, parsed.secret, requestedGroup);
  if (!device) return c.json({ ok: false, error: 'AUTH_INVALID' }, 401);
  c.set('device', device);
  await next();
});

/**
 * 任意認証（グループ作成/参加用・§12-2）。Authorization が無ければ null、
 * あるのに無効なら 'invalid'（既存端末のフリをした乗っ取りを黙って通さない）。
 */
async function optionalDevice(
  authHeader: string | undefined,
): Promise<AuthedDevice | null | 'invalid'> {
  const parsed = parseAuthHeader(authHeader);
  if (!parsed) return null;
  const device = await authenticateDevice(parsed.deviceId, parsed.secret);
  return device ?? 'invalid';
}

/**
 * `displayName` は **受け取るが保存しない**。
 *
 * サーバーに個人情報を置かない（設計 §2）。返しもしないので使い道が無く、
 * 置けば「人についての自由文がサーバーにある」状態になるだけだった。
 * スキーマから消さないのは、古い版のアプリが送ってきても 400 にしないため。
 */
const ignoredDisplayNameSchema = z.string().trim().max(30);

const groupNameSchema = z.string().trim().min(1).max(30);
const groupScopeSchema = z.enum(['all', 'recipes']);

const createGroupSchema = z.object({
  displayName: ignoredDisplayNameSchema.optional(),
  /** グループの表示名（§12・任意）。個人名ではなくグループの呼び名 */
  name: groupNameSchema.optional(),
  scope: groupScopeSchema.optional(),
});

const joinGroupSchema = z.object({
  inviteCode: z.string().trim().min(4).max(16),
  displayName: ignoredDisplayNameSchema.optional(),
});

/**
 * グループ新設 → 端末クレデンシャルと招待コードを返す（シークレットはこの応答限り）。
 * Authorization つきなら**既存端末の 2 つ目以降のグループ**として作る（§12-2 —
 * 新しい端末は発行されず、deviceSecret は空で返る）。
 */
syncRouter.post('/groups', zValidator('json', createGroupSchema), async (c) => {
  if (!takeSyncRateLimit('create', clientKeyOf(c.req.raw.headers))) {
    return c.json({ ok: false, error: 'RATE_LIMITED' }, 429);
  }
  const authed = await optionalDevice(c.req.header('authorization'));
  if (authed === 'invalid') return c.json({ ok: false, error: 'AUTH_INVALID' }, 401);
  const body = c.req.valid('json');
  const created = await createGroup({
    name: body.name ?? null,
    scope: body.scope ?? 'all',
    ...(authed ? { existingDeviceId: authed.deviceId } : {}),
  });
  return c.json({ ok: true, data: created }, 201);
});

/** 招待コードで参加。Authorization つきなら既存端末の追加参加（§12-2） */
syncRouter.post('/groups/join', zValidator('json', joinGroupSchema), async (c) => {
  if (!takeSyncRateLimit('join', clientKeyOf(c.req.raw.headers))) {
    return c.json({ ok: false, error: 'RATE_LIMITED' }, 429);
  }
  const authed = await optionalDevice(c.req.header('authorization'));
  if (authed === 'invalid') return c.json({ ok: false, error: 'AUTH_INVALID' }, 401);
  const body = c.req.valid('json');
  const result = await joinGroup(body.inviteCode, authed ? authed.deviceId : null);
  switch (result.kind) {
    case 'invalid':
      return c.json({ ok: false, error: 'INVITE_INVALID' }, 404);
    case 'expired':
      return c.json({ ok: false, error: 'INVITE_EXPIRED' }, 410);
    case 'full':
      return c.json({ ok: false, error: 'GROUP_FULL' }, 409);
    case 'joined': {
      // 参加確認ダイアログの開示（G6）: 何のグループに・何が共有されるスコープで入るのか
      const info = await getGroupInfo(result.groupId);
      return c.json({
        ok: true,
        data: {
          groupId: result.groupId,
          deviceId: result.deviceId,
          deviceSecret: result.deviceSecret,
          memberCount: result.memberCount,
          groupName: info?.name ?? null,
          scope: info?.scope ?? 'all',
        },
      });
    }
  }
});

/** 自分が参加しているグループの一覧（§12-2）。x-sync-group に依らない */
syncRouter.get('/me/groups', requireDevice, async (c) => {
  const device = c.get('device');
  const groups = await listDeviceGroups(device.deviceId);
  return c.json({ ok: true, data: { groups } });
});

const updateGroupSchema = z
  .object({
    name: groupNameSchema.nullable().optional(),
    scope: groupScopeSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.scope !== undefined, {
    message: 'name or scope is required',
  });

/**
 * グループの名前・スコープ変更（オーナーのみ・§12-2）。
 * scope の縮小で「何が見えなくなるか」の予告（G4）はアプリ側の責務 —
 * サーバーは即時適用し、以後 scope 外は pull に現れず push は 400 になる。
 */
syncRouter.patch('/group', requireDevice, zValidator('json', updateGroupSchema), async (c) => {
  const device = c.get('device');
  if (!device.isOwner) return c.json({ ok: false, error: 'OWNER_ONLY' }, 403);
  const body = c.req.valid('json');
  await updateGroup(device.groupId, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.scope !== undefined ? { scope: body.scope } : {}),
  });
  return c.json({ ok: true });
});

/** 自分の状態（認証の疎通確認を兼ねる）。招待コードはオーナーにだけ返す */
syncRouter.get('/me', requireDevice, async (c) => {
  const device = c.get('device');
  // 状態確認のついでに休眠端末を整理し、オーナー不在なら引き継ぐ（#209）
  await reapStaleDevices(device.groupId, device.deviceId);
  const info = await getGroupInfo(device.groupId);
  if (!info) return c.json({ ok: false, error: 'AUTH_INVALID' }, 401);
  // 引き継ぎで自分がオーナーになった直後は `device.isOwner`（認証時の値）が古い
  const isOwner = info.devices.some((d) => d.id === device.deviceId && d.isOwner);
  return c.json({
    ok: true,
    data: {
      groupId: device.groupId,
      deviceId: device.deviceId,
      isOwner,
      groupName: info.name,
      scope: info.scope,
      memberCount: info.memberCount,
      // 端末一覧は id・役割・最終同期時刻だけ（名前も内容も無い — §0-2）
      devices: info.devices.map((d) => ({
        id: d.id,
        isOwner: d.isOwner,
        isSelf: d.id === device.deviceId,
        lastSeenAt: d.lastSeenAt,
      })),
      ...(isOwner ? { inviteCode: info.inviteCode, inviteExpiresAt: info.inviteExpiresAt } : {}),
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

/**
 * オーナーが他の端末を外す（#209）。外したあと招待コードを回して、同じコードで
 * 入り直せないようにする。**`/devices/me` より後ろに登録する**（Hono は登録順に照合するので、
 * 前に置くと `:id` が 'me' を食って離脱が 403 になる）。
 */
syncRouter.delete('/devices/:id', requireDevice, async (c) => {
  const device = c.get('device');
  const target = c.req.param('id');
  // 引き継ぎ直後は認証時の isOwner が古いので、いまの状態で判定する
  await reapStaleDevices(device.groupId, device.deviceId);
  const info = await getGroupInfo(device.groupId);
  const isOwner = info?.devices.some((d) => d.id === device.deviceId && d.isOwner) ?? false;
  if (!isOwner) return c.json({ ok: false, error: 'OWNER_ONLY' }, 403);
  if (target === device.deviceId) return c.json({ ok: false, error: 'BAD_REQUEST' }, 400);
  const removed = await evictDevice({ ...device, isOwner: true }, target);
  if (!removed) return c.json({ ok: false, error: 'NOT_FOUND' }, 404);
  const rotated = await rotateInvite(device.groupId);
  return c.json({ ok: true, data: rotated });
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
  forgetNotifySlot(device.groupId);
  return c.json({ ok: true });
});

// ── S1: push / pull（設計 §5-1b） ────────────────────────────────────────────

/** payload はレシピ丸ごと（材料・手順込み）を想定 — 余裕を見て 300KB で弾く */
const MAX_PAYLOAD_CHARS = 300_000;
const MAX_CHANGES_PER_PUSH = 200;

const pushSchema = z.object({
  changes: z
    .array(
      z
        .object({
          entityType: z.string().min(1).max(40),
          // 在庫の持ち分は `<品目 id>:<端末 id>`（59 字）。64 では余裕が 5 字しか無い（設計 §5-3 審査⑦）
          entityId: z.string().min(1).max(128),
          payload: z.string().max(MAX_PAYLOAD_CHARS).nullable(),
          clientUpdatedAt: z.string().datetime({ offset: true }),
          deleted: z.boolean(),
        })
        // **削除でないのに payload が無い変更は受けない。** 受けると空文字が保存され、
        // 他端末はそのエンティティを永久に読めない（読めない受信はカーソルを進めて
        // 読み飛ばすので、その行は再 push まで死んだまま）
        .refine((change) => change.deleted || change.payload !== null, {
          message: 'payload is required unless deleted',
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
// 在庫の持ち分（S2-B・設計 §5-3）はタップだけの push に行を含まないので、急ぎ側に入れる
const URGENT_ENTITY_TYPES = new Set(['shopping_item', 'pantry_item', 'pantry_quantity']);

export function isUrgentChange(entityTypes: readonly string[]): boolean {
  return entityTypes.some((type) => URGENT_ENTITY_TYPES.has(type));
}

const lastNotifiedAt = new Map<string, number>();

/** 期限の切れた記録を捨てる（消えたグループの分が残り続けないように） */
function sweepNotifySlots(now: number): void {
  if (lastNotifiedAt.size < 1000) return;
  for (const [groupId, at] of lastNotifiedAt) {
    if (now - at >= NOTIFY_DEBOUNCE_MS) lastNotifiedAt.delete(groupId);
  }
}

export function takeNotifySlot(groupId: string, now = Date.now(), urgent = false): boolean {
  sweepNotifySlots(now);
  const window = urgent ? NOTIFY_DEBOUNCE_URGENT_MS : NOTIFY_DEBOUNCE_MS;
  const last = lastNotifiedAt.get(groupId);
  if (last !== undefined && now - last < window) return false;
  lastNotifiedAt.set(groupId, now);
  return true;
}

/** グループを消したら通知の記録も捨てる */
export function forgetNotifySlot(groupId: string): void {
  lastNotifiedAt.delete(groupId);
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
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
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
    // 届かないトークンは消す（#207）。応答の tickets は送った順に並ぶ
    const body = (await res.json().catch(() => null)) as {
      data?: { status?: string; details?: { error?: string } }[];
    } | null;
    const dead = (body?.data ?? [])
      .map((ticket, index) =>
        ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
          ? targets[index]?.token
          : undefined,
      )
      .filter((token): token is string => typeof token === 'string');
    if (dead.length > 0) await clearDeadPushTokens(dead);
  } catch {
    // ベストエフォート
  }
}

/**
 * 1 回の push の**合計**サイズ。
 *
 * 1 件ごとの上限（300KB）だけだと 200 件 × 300KB = 60MB を 1 回で送れてしまう。
 * 本文はメモリに載せてから検証されるので、合計でも押さえておく。
 */
const MAX_PUSH_TOTAL_CHARS = 4_000_000;

syncRouter.post('/push', requireDevice, zValidator('json', pushSchema), async (c) => {
  const device = c.get('device');
  const { changes } = c.req.valid('json');

  const totalChars = changes.reduce((sum, change) => sum + (change.payload?.length ?? 0), 0);
  if (totalChars > MAX_PUSH_TOTAL_CHARS) {
    return c.json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  }
  // スコープの門番（§12-1）: 'recipes' のグループへレシピ系以外は流させない
  if (changes.some((change) => !isTypeAllowedForScope(device.scope, change.entityType))) {
    return c.json({ ok: false, error: 'SCOPE_MISMATCH' }, 400);
  }
  // 端末ごとの日次上限。1 件 = 1 消費なので、ふつうの使い方では当たらない
  if (!takeSyncRateLimit('push', device.deviceId, changes.length)) {
    return c.json({ ok: false, error: 'RATE_LIMITED' }, 429);
  }

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
  // 上限も見る。`1e30` は Number.isInteger を通るが BIGINT に入らず 500 になる
  if (!Number.isInteger(since) || since < 0 || since > Number.MAX_SAFE_INTEGER) {
    return c.json({ ok: false, error: 'BAD_REQUEST' }, 400);
  }
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 500;
  const result = await pullChanges(device, since, limit);
  return c.json({ ok: true, data: result });
});

const deviceUpdateSchema = z.object({
  /**
   * Expo の形式だけ受ける。任意の文字列を通すと、グループの誰かが登録した
   * 無関係なトークンへ（固定文言とはいえ）通知を中継する装置になる
   */
  expoPushToken: z
    .string()
    .max(200)
    .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/)
    .nullable()
    .optional(),
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
