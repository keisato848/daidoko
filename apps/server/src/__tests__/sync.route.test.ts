/**
 * クラウド同期 API（S0）。
 *
 * 2 層でテストする:
 * 1. **無効時の振る舞い**（常に実行）— DATABASE_URL の無い環境では 503 を返し、
 *    サーバー本体は動き続ける（DB の追加とアプリ配布が別々に進んでも壊れない）
 * 2. **実 PostgreSQL での一気通貫**（`TEST_DATABASE_URL` があるときだけ）—
 *    作成 → 参加 → 認証 → ローテーション → 離脱 → 削除。
 *    ローカルは `docker compose -f docker-compose.dev.yml up -d postgres` で
 *    `TEST_DATABASE_URL=postgres://daidoko:password@localhost:5432/daidoko_dev`。
 *    CI には PostgreSQL が無いのでスキップされる（純関数は sync-auth.test.ts が常時カバー）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../index.js';
import { closeSyncStoreForTesting } from '../lib/sync-store.js';
import { resetSyncRateLimitForTesting } from '../routes/sync.js';

const TEST_DB = process.env['TEST_DATABASE_URL'];

function authHeader(deviceId: string, secret: string): Record<string, string> {
  return { Authorization: `Bearer ${deviceId}.${secret}` };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('同期が無効な環境（DATABASE_URL なし）', () => {
  const saved = {
    db: process.env['DATABASE_URL'],
    sync: process.env['SYNC_DATABASE_URL'],
  };

  beforeAll(() => {
    delete process.env['DATABASE_URL'];
    delete process.env['SYNC_DATABASE_URL'];
  });

  afterAll(() => {
    if (saved.db !== undefined) process.env['DATABASE_URL'] = saved.db;
    if (saved.sync !== undefined) process.env['SYNC_DATABASE_URL'] = saved.sync;
  });

  it('全エンドポイントが 503 SYNC_DISABLED（サーバー本体は落ちない）', async () => {
    const res = await post('/api/v1/sync/groups', {});
    expect(res.status).toBe(503);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'SYNC_DISABLED' });

    const me = await app.request('/api/v1/sync/me');
    expect(me.status).toBe(503);

    // 同期以外の機能は無影響
    const health = await app.request('/health');
    expect(health.status).toBe(200);
  });
});

describe.runIf(Boolean(TEST_DB))('実 PostgreSQL での一気通貫', () => {
  beforeAll(() => {
    process.env['SYNC_DATABASE_URL'] = TEST_DB as string;
    resetSyncRateLimitForTesting();
  });

  afterAll(async () => {
    delete process.env['SYNC_DATABASE_URL'];
    await closeSyncStoreForTesting();
  });

  let owner: { deviceId: string; secret: string };
  let member: { deviceId: string; secret: string };
  let inviteCode: string;

  it('グループ作成 → クレデンシャルと招待コードが返る', async () => {
    const res = await post('/api/v1/sync/groups', { displayName: 'けい' });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      ok: boolean;
      data: { groupId: string; deviceId: string; deviceSecret: string; inviteCode: string };
    };
    expect(json.ok).toBe(true);
    expect(json.data.deviceSecret.length).toBeGreaterThan(30);
    expect(json.data.inviteCode).toHaveLength(8);
    owner = { deviceId: json.data.deviceId, secret: json.data.deviceSecret };
    inviteCode = json.data.inviteCode;
  });

  it('/me: オーナーには招待コードが見える', async () => {
    const res = await app.request('/api/v1/sync/me', {
      headers: authHeader(owner.deviceId, owner.secret),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { isOwner: boolean; memberCount: number; inviteCode?: string };
    };
    expect(json.data.isOwner).toBe(true);
    expect(json.data.memberCount).toBe(1);
    expect(json.data.inviteCode).toBe(inviteCode);
  });

  it('招待コードで参加できる（小文字・空白まじりでも）', async () => {
    const sloppy = ` ${inviteCode.toLowerCase().slice(0, 4)} ${inviteCode.slice(4)} `;
    const res = await post('/api/v1/sync/groups/join', { inviteCode: sloppy });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { deviceId: string; deviceSecret: string; memberCount: number };
    };
    expect(json.data.memberCount).toBe(2);
    member = { deviceId: json.data.deviceId, secret: json.data.deviceSecret };
  });

  it('/me: メンバーには招待コードを見せない', async () => {
    const res = await app.request('/api/v1/sync/me', {
      headers: authHeader(member.deviceId, member.secret),
    });
    const json = (await res.json()) as {
      data: { isOwner: boolean; memberCount: number; inviteCode?: string };
    };
    expect(json.data.isOwner).toBe(false);
    expect(json.data.memberCount).toBe(2);
    expect(json.data.inviteCode).toBeUndefined();
  });

  it('でたらめなコードは 404・壊れた認証は 401', async () => {
    const bad = await post('/api/v1/sync/groups/join', { inviteCode: 'ZZZZZZZZ' });
    expect(bad.status).toBe(404);

    const wrongSecret = await app.request('/api/v1/sync/me', {
      headers: authHeader(owner.deviceId, 'wrong-secret'),
    });
    expect(wrongSecret.status).toBe(401);
  });

  it('招待の再発行はオーナーのみ。旧コードは即無効', async () => {
    const denied = await post(
      '/api/v1/sync/invite/rotate',
      {},
      authHeader(member.deviceId, member.secret),
    );
    expect(denied.status).toBe(403);

    const rotated = await post(
      '/api/v1/sync/invite/rotate',
      {},
      authHeader(owner.deviceId, owner.secret),
    );
    expect(rotated.status).toBe(200);
    const json = (await rotated.json()) as { data: { inviteCode: string } };
    expect(json.data.inviteCode).not.toBe(inviteCode);

    const oldCode = await post('/api/v1/sync/groups/join', { inviteCode });
    expect(oldCode.status).toBe(404);
    inviteCode = json.data.inviteCode;
  });

  it('メンバーが離脱すると人数が減る', async () => {
    const res = await app.request('/api/v1/sync/devices/me', {
      method: 'DELETE',
      headers: authHeader(member.deviceId, member.secret),
    });
    expect(res.status).toBe(200);

    const me = await app.request('/api/v1/sync/me', {
      headers: authHeader(owner.deviceId, owner.secret),
    });
    const json = (await me.json()) as { data: { memberCount: number } };
    expect(json.data.memberCount).toBe(1);
  });

  it('グループ削除はオーナーのみ・confirm 必須。消えたら認証も通らない', async () => {
    const noConfirm = await app.request('/api/v1/sync/group', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader(owner.deviceId, owner.secret) },
      body: JSON.stringify({}),
    });
    expect(noConfirm.status).toBe(400);

    const res = await app.request('/api/v1/sync/group', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader(owner.deviceId, owner.secret) },
      body: JSON.stringify({ confirm: true }),
    });
    expect(res.status).toBe(200);

    const after = await app.request('/api/v1/sync/me', {
      headers: authHeader(owner.deviceId, owner.secret),
    });
    expect(after.status).toBe(401);
  });
});
