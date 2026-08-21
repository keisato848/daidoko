/**
 * クラウド同期 API（S0）。
 *
 * 2 層でテストする:
 * 1. **無効時の振る舞い**（常に実行）— DATABASE_URL の無い環境では 503 を返し、
 *    サーバー本体は動き続ける（DB の追加とアプリ配布が別々に進んでも壊れない）
 * 2. **実 PostgreSQL での一気通貫**（`TEST_DATABASE_URL` があるときだけ）—
 *    作成 → 参加 → 認証 → ローテーション → 離脱 → 削除。
 *    ローカルは `docker compose -f docker-compose.dev.yml up -d postgres` で
 *    `TEST_DATABASE_URL=postgres://daidoko:password@localhost:5433/daidoko_dev（5432 は他プロジェクトが使用中）`。
 *    CI には PostgreSQL が無いのでスキップされる（純関数は sync-auth.test.ts が常時カバー）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { closeSyncStoreForTesting } from '../lib/sync-store.js';
import {
  SYNC_NOTIFICATION_TEXT,
  notificationTextFor,
  resetSyncNotifyDebounceForTesting,
  resetSyncRateLimitForTesting,
  takeNotifySlot,
} from '../routes/sync.js';

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

describe.runIf(Boolean(TEST_DB))('S1: push / pull（実 PostgreSQL）', () => {
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

  async function cleanup() {
    // グループ削除（オーナー）で後始末
    await app.request('/api/v1/sync/group', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader(owner.deviceId, owner.secret) },
      body: JSON.stringify({ confirm: true }),
    });
  }

  it('push した変更が、他端末の pull に seq 順で届く', async () => {
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { deviceId: string; deviceSecret: string; inviteCode: string };
    };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };
    const joined = await post('/api/v1/sync/groups/join', { inviteCode: cj.data.inviteCode });
    const jj = (await joined.json()) as { data: { deviceId: string; deviceSecret: string } };
    member = { deviceId: jj.data.deviceId, secret: jj.data.deviceSecret };

    const push = await post(
      '/api/v1/sync/push',
      {
        changes: [
          {
            entityType: 'recipe',
            entityId: 'r1',
            payload: JSON.stringify({ title: '肉じゃが', schemaVersion: 13 }),
            clientUpdatedAt: '2026-08-21T12:00:00.000Z',
            deleted: false,
          },
          {
            entityType: 'recipe_book',
            entityId: 'b1',
            payload: JSON.stringify({ title: '週末の帖', recipeIds: ['r1'] }),
            clientUpdatedAt: '2026-08-21T12:00:01.000Z',
            deleted: false,
          },
        ],
      },
      authHeader(owner.deviceId, owner.secret),
    );
    expect(push.status).toBe(200);
    const pj = (await push.json()) as { data: { applied: number; latestSeq: number } };
    expect(pj.data.applied).toBe(2);

    const pull = await app.request('/api/v1/sync/pull?since=0', {
      headers: authHeader(member.deviceId, member.secret),
    });
    expect(pull.status).toBe(200);
    const plj = (await pull.json()) as {
      data: {
        changes: { entityId: string; seq: number; updatedByDevice: string }[];
        hasMore: boolean;
        latestSeq: number;
      };
    };
    expect(plj.data.changes.map((chg) => chg.entityId)).toEqual(['r1', 'b1']);
    expect(plj.data.changes[0]?.updatedByDevice).toBe(owner.deviceId);
    expect(plj.data.hasMore).toBe(false);
  });

  it('LWW: 古い変更は捨てられ、新しい変更は置き換える', async () => {
    const stale = await post(
      '/api/v1/sync/push',
      {
        changes: [
          {
            entityType: 'recipe',
            entityId: 'r1',
            payload: JSON.stringify({ title: '古い肉じゃが' }),
            clientUpdatedAt: '2026-08-21T11:00:00.000Z',
            deleted: false,
          },
        ],
      },
      authHeader(member.deviceId, member.secret),
    );
    expect(((await stale.json()) as { data: { applied: number } }).data.applied).toBe(0);

    const fresh = await post(
      '/api/v1/sync/push',
      {
        changes: [
          {
            entityType: 'recipe',
            entityId: 'r1',
            payload: JSON.stringify({ title: '新しい肉じゃが' }),
            clientUpdatedAt: '2026-08-21T13:00:00.000Z',
            deleted: false,
          },
        ],
      },
      authHeader(member.deviceId, member.secret),
    );
    expect(((await fresh.json()) as { data: { applied: number } }).data.applied).toBe(1);

    const pull = await app.request('/api/v1/sync/pull?since=0', {
      headers: authHeader(owner.deviceId, owner.secret),
    });
    const pj = (await pull.json()) as {
      data: { changes: { entityId: string; payload: string | null }[] };
    };
    const r1 = pj.data.changes.find((chg) => chg.entityId === 'r1');
    expect(JSON.parse(r1?.payload ?? '{}').title).toBe('新しい肉じゃが');
  });

  it('削除は tombstone として届く', async () => {
    await post(
      '/api/v1/sync/push',
      {
        changes: [
          {
            entityType: 'recipe',
            entityId: 'r1',
            payload: null,
            clientUpdatedAt: '2026-08-21T14:00:00.000Z',
            deleted: true,
          },
        ],
      },
      authHeader(owner.deviceId, owner.secret),
    );
    const pull = await app.request('/api/v1/sync/pull?since=0', {
      headers: authHeader(member.deviceId, member.secret),
    });
    const pj = (await pull.json()) as {
      data: { changes: { entityId: string; deleted: boolean; payload: string | null }[] };
    };
    const r1 = pj.data.changes.find((chg) => chg.entityId === 'r1');
    expect(r1?.deleted).toBe(true);
    expect(r1?.payload).toBeNull();
    await cleanup();
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

/**
 * 変更通知は「中身を持たない同期のきっかけ」だけ（設計 §0-2）。
 * ここが崩れると、電気通信事業の該当性判定の前提そのものが変わる。
 */
describe('変更通知の文面と間引き', () => {
  beforeEach(() => {
    resetSyncNotifyDebounceForTesting();
  });

  it('文面は固定で、利用者名・件数・データの内容を含まない', () => {
    for (const text of Object.values(SYNC_NOTIFICATION_TEXT)) {
      const joined = `${text.title} ${text.body}`;
      // 差し込み（テンプレート）が無い＝内容を載せる余地が無い
      expect(joined).not.toMatch(/[{}$%]|\d/);
    }
  });

  it('端末の表示言語で文面を選ぶ（未登録は日本語）', () => {
    expect(notificationTextFor('en')).toEqual(SYNC_NOTIFICATION_TEXT.en);
    expect(notificationTextFor('ja')).toEqual(SYNC_NOTIFICATION_TEXT.ja);
    expect(notificationTextFor(null)).toEqual(SYNC_NOTIFICATION_TEXT.ja);
  });

  it('同じグループへは 5 分に 1 回まで（通知疲れを作らない）', () => {
    const base = Date.parse('2026-08-21T10:00:00.000Z');
    expect(takeNotifySlot('group-1', base)).toBe(true);
    expect(takeNotifySlot('group-1', base + 60_000)).toBe(false);
    expect(takeNotifySlot('group-1', base + 5 * 60_000)).toBe(true);
  });

  it('グループごとに独立して数える', () => {
    const base = Date.parse('2026-08-21T10:00:00.000Z');
    expect(takeNotifySlot('group-1', base)).toBe(true);
    expect(takeNotifySlot('group-2', base)).toBe(true);
  });
});
