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
  isUrgentChange,
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
  });
  // グループ作成は 1 クライアント 10 回/日で頭打ち。テストを足すと静かに 429 になり、
  // 「data が undefined」という分かりにくい失敗になるので、各テストで枠を戻す
  beforeEach(() => {
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

  it('LWW で負けた push も seq が動き、送り主が勝者を pull し直せる', async () => {
    // **黙って捨てない**のがここの主題。捨てるだけだと、負けた端末のカーソルが
    // 既に勝者の seq を越えている場合、勝者が二度と降りてこない（設計 §5-2d）
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { deviceId: string; deviceSecret: string; inviteCode: string };
    };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };
    const joined = await post('/api/v1/sync/groups/join', { inviteCode: cj.data.inviteCode });
    const jj = (await joined.json()) as { data: { deviceId: string; deviceSecret: string } };
    member = { deviceId: jj.data.deviceId, secret: jj.data.deviceSecret };

    // 勝者（新しい）を owner が push
    await post(
      '/api/v1/sync/push',
      {
        changes: [
          {
            entityType: 'recipe',
            entityId: 'lww1',
            payload: JSON.stringify({ title: 'あたらしい' }),
            clientUpdatedAt: '2026-08-21T12:00:10.000Z',
            deleted: false,
          },
        ],
      },
      authHeader(owner.deviceId, owner.secret),
    );

    // member が受け取ってカーソルを進める
    const first = await app.request('/api/v1/sync/pull?since=0', {
      headers: authHeader(member.deviceId, member.secret),
    });
    const fj = (await first.json()) as { data: { changes: { seq: number }[] } };
    const cursor = Math.max(...fj.data.changes.map((chg) => chg.seq));

    // member が古い版を push → 採用されない
    const push = await post(
      '/api/v1/sync/push',
      {
        changes: [
          {
            entityType: 'recipe',
            entityId: 'lww1',
            payload: JSON.stringify({ title: 'ふるい' }),
            clientUpdatedAt: '2026-08-21T12:00:00.000Z',
            deleted: false,
          },
        ],
      },
      authHeader(member.deviceId, member.secret),
    );
    const pj = (await push.json()) as { data: { applied: number } };
    expect(pj.data.applied).toBe(0);

    // **カーソルの先に勝者がもう一度現れる**（中身は勝者のまま）
    const again = await app.request(`/api/v1/sync/pull?since=${cursor}`, {
      headers: authHeader(member.deviceId, member.secret),
    });
    const aj = (await again.json()) as {
      data: { changes: { entityId: string; payload: string; updatedByDevice: string }[] };
    };
    const recovered = aj.data.changes.find((chg) => chg.entityId === 'lww1');
    expect(recovered).toBeDefined();
    if (!recovered) throw new Error('unreachable');
    expect(JSON.parse(recovered.payload) as { title: string }).toEqual({ title: 'あたらしい' });
    expect(recovered.updatedByDevice).toBe(owner.deviceId);

    await cleanup();
  });

  it('進みすぎた端末の時計は頭打ちにする（1台の狂った時計で永久に凍らせない）', async () => {
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { deviceId: string; deviceSecret: string; inviteCode: string };
    };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };

    await post(
      '/api/v1/sync/push',
      {
        changes: [
          {
            entityType: 'recipe',
            entityId: 'skew1',
            payload: JSON.stringify({ title: '未来' }),
            clientUpdatedAt: '2099-01-01T00:00:00.000Z',
            deleted: false,
          },
        ],
      },
      authHeader(owner.deviceId, owner.secret),
    );

    const pull = await app.request('/api/v1/sync/pull?since=0', {
      headers: authHeader(owner.deviceId, owner.secret),
    });
    const plj = (await pull.json()) as {
      data: { changes: { entityId: string; clientUpdatedAt: string }[] };
    };
    const stored = plj.data.changes.find((chg) => chg.entityId === 'skew1');
    expect(stored).toBeDefined();
    if (!stored) throw new Error('unreachable');
    // 5 分の余裕まで。2099 年がそのまま入っていたら以後どの編集も勝てなくなる
    expect(Date.parse(stored.clientUpdatedAt)).toBeLessThanOrEqual(Date.now() + 6 * 60_000);

    await cleanup();
  });

  it('削除でないのに payload が無い変更は 400（読めない行をサーバーに作らない）', async () => {
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { deviceId: string; deviceSecret: string };
    };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };

    const res = await post(
      '/api/v1/sync/push',
      {
        changes: [
          {
            entityType: 'recipe',
            entityId: 'nopayload',
            payload: null,
            clientUpdatedAt: '2026-08-21T12:00:00.000Z',
            deleted: false,
          },
        ],
      },
      authHeader(owner.deviceId, owner.secret),
    );
    expect(res.status).toBe(400);

    await cleanup();
  });

  it('since が桁外れなら 400（BIGINT に入らない値で 500 にしない）', async () => {
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as { data: { deviceId: string; deviceSecret: string } };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };

    const res = await app.request('/api/v1/sync/pull?since=1e30', {
      headers: authHeader(owner.deviceId, owner.secret),
    });
    expect(res.status).toBe(400);

    await cleanup();
  });

  it('同じ品目を 2 台が同時に push しても、新しい方が残る（直列化）', async () => {
    // 買い物中の「同時にチェック」がこの機能の主用途。ロック無しだと古い判定で
    // 新しい方を踏み潰し、踏まれた端末は 200 を受けているので二度と送らない
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { deviceId: string; deviceSecret: string; inviteCode: string };
    };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };
    const joined = await post('/api/v1/sync/groups/join', { inviteCode: cj.data.inviteCode });
    const jj = (await joined.json()) as { data: { deviceId: string; deviceSecret: string } };
    member = { deviceId: jj.data.deviceId, secret: jj.data.deviceSecret };

    const change = (title: string, at: string) => ({
      changes: [
        {
          entityType: 'shopping_item',
          entityId: 'race1',
          payload: JSON.stringify({ title }),
          clientUpdatedAt: at,
          deleted: false,
        },
      ],
    });

    for (let round = 0; round < 5; round += 1) {
      const older = `2026-08-21T12:00:${String(round * 2).padStart(2, '0')}.000Z`;
      const newer = `2026-08-21T12:00:${String(round * 2 + 1).padStart(2, '0')}.000Z`;
      // 新しい方を owner、古い方を member が**同時に**送る
      await Promise.all([
        post('/api/v1/sync/push', change('newer', newer), authHeader(owner.deviceId, owner.secret)),
        post(
          '/api/v1/sync/push',
          change('older', older),
          authHeader(member.deviceId, member.secret),
        ),
      ]);
      const pull = await app.request('/api/v1/sync/pull?since=0', {
        headers: authHeader(owner.deviceId, owner.secret),
      });
      const plj = (await pull.json()) as {
        data: { changes: { entityId: string; payload: string; clientUpdatedAt: string }[] };
      };
      const row = plj.data.changes.find((chg) => chg.entityId === 'race1');
      expect(row).toBeDefined();
      if (!row) throw new Error('unreachable');
      expect(JSON.parse(row.payload) as { title: string }).toEqual({ title: 'newer' });
      expect(row.clientUpdatedAt).toBe(newer);
    }

    await cleanup();
  });

  it('オーナーは他の端末を外せる。外された端末は 401 になり、招待コードが回る（#209）', async () => {
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { deviceId: string; deviceSecret: string; inviteCode: string };
    };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };
    const joined = await post('/api/v1/sync/groups/join', { inviteCode: cj.data.inviteCode });
    const jj = (await joined.json()) as { data: { deviceId: string; deviceSecret: string } };
    member = { deviceId: jj.data.deviceId, secret: jj.data.deviceSecret };

    // /me に端末一覧が載る（id・役割・最終同期だけ）
    const me = await app.request('/api/v1/sync/me', {
      headers: authHeader(owner.deviceId, owner.secret),
    });
    const mj = (await me.json()) as {
      data: { devices: { id: string; isOwner: boolean; isSelf: boolean; lastSeenAt: string }[] };
    };
    expect(mj.data.devices).toHaveLength(2);
    expect(mj.data.devices.find((d) => d.isSelf)?.isOwner).toBe(true);
    for (const d of mj.data.devices)
      expect(Object.keys(d).sort()).toEqual(['id', 'isOwner', 'isSelf', 'lastSeenAt']);

    // メンバーは外せない
    const denied = await app.request(`/api/v1/sync/devices/${owner.deviceId}`, {
      method: 'DELETE',
      headers: authHeader(member.deviceId, member.secret),
    });
    expect(denied.status).toBe(403);

    // オーナーが外す → 新しい招待コードが返る
    const evicted = await app.request(`/api/v1/sync/devices/${member.deviceId}`, {
      method: 'DELETE',
      headers: authHeader(owner.deviceId, owner.secret),
    });
    expect(evicted.status).toBe(200);
    const ej = (await evicted.json()) as { data: { inviteCode: string } };
    expect(ej.data.inviteCode).not.toBe(cj.data.inviteCode);

    const after = await app.request('/api/v1/sync/me', {
      headers: authHeader(member.deviceId, member.secret),
    });
    expect(after.status).toBe(401);

    await cleanup();
  });

  it('オーナーが 14 日同期していなければ、最も古い生存端末へ所有権が移る（#209）', async () => {
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { deviceId: string; deviceSecret: string; inviteCode: string };
    };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };
    const joined = await post('/api/v1/sync/groups/join', { inviteCode: cj.data.inviteCode });
    const jj = (await joined.json()) as { data: { deviceId: string; deviceSecret: string } };
    member = { deviceId: jj.data.deviceId, secret: jj.data.deviceSecret };

    // オーナーの最終同期を 20 日前に倒す（テストだけが触る裏口）
    const postgres = (await import('postgres')).default;
    const sql = postgres(TEST_DB as string, { max: 1 });
    await sql`UPDATE sync_devices SET last_seen_at = now() - interval '20 days' WHERE id = ${owner.deviceId}`;
    await sql.end();

    const me = await app.request('/api/v1/sync/me', {
      headers: authHeader(member.deviceId, member.secret),
    });
    const mj = (await me.json()) as { data: { isOwner: boolean; inviteCode?: string } };
    expect(mj.data.isOwner).toBe(true);
    expect(mj.data.inviteCode).toBeDefined();

    // 元オーナーは member になっている（ただし外されてはいない）
    const old = await app.request('/api/v1/sync/me', {
      headers: authHeader(owner.deviceId, owner.secret),
    });
    expect(old.status).toBe(200);
    const oj = (await old.json()) as { data: { isOwner: boolean } };
    expect(oj.data.isOwner).toBe(false);

    // 後始末は新オーナー（member）で
    await app.request('/api/v1/sync/group', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(member.deviceId, member.secret),
      },
      body: JSON.stringify({ confirm: true }),
    });
  });

  it('90 日同期していない端末は、誰かの参加のついでに消える（#209）', async () => {
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { deviceId: string; deviceSecret: string; inviteCode: string };
    };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };
    const joined = await post('/api/v1/sync/groups/join', { inviteCode: cj.data.inviteCode });
    const jj = (await joined.json()) as { data: { deviceId: string; deviceSecret: string } };
    const ghost = { deviceId: jj.data.deviceId, secret: jj.data.deviceSecret };

    const postgres = (await import('postgres')).default;
    const sql = postgres(TEST_DB as string, { max: 1 });
    await sql`UPDATE sync_devices SET last_seen_at = now() - interval '100 days' WHERE id = ${ghost.deviceId}`;
    await sql.end();

    const again = await post('/api/v1/sync/groups/join', { inviteCode: cj.data.inviteCode });
    const aj = (await again.json()) as {
      data: { deviceId: string; deviceSecret: string; memberCount: number };
    };
    member = { deviceId: aj.data.deviceId, secret: aj.data.deviceSecret };
    expect(aj.data.memberCount).toBe(2); // owner + 新しい端末。幽霊は消えた

    const gone = await app.request('/api/v1/sync/me', {
      headers: authHeader(ghost.deviceId, ghost.secret),
    });
    expect(gone.status).toBe(401);

    await cleanup();
  });

  it('在庫の持ち分（entity_id が 59 字）を push/pull できる（S2-B・設計 §5-3）', async () => {
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { deviceId: string; deviceSecret: string; inviteCode: string };
    };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };
    const joined = await post('/api/v1/sync/groups/join', { inviteCode: cj.data.inviteCode });
    const jj = (await joined.json()) as { data: { deviceId: string; deviceSecret: string } };
    member = { deviceId: jj.data.deviceId, secret: jj.data.deviceSecret };

    const itemId = '0f3a2a1c-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
    const partId = `${itemId}:${owner.deviceId}`;
    expect(partId.length).toBeGreaterThanOrEqual(59);
    const push = await post(
      '/api/v1/sync/push',
      {
        changes: [
          {
            entityType: 'pantry_quantity',
            entityId: partId,
            payload: JSON.stringify({ itemId, deviceId: owner.deviceId, net: -3, epoch: 1 }),
            clientUpdatedAt: '2026-08-22T12:00:00.000Z',
            deleted: false,
          },
        ],
      },
      authHeader(owner.deviceId, owner.secret),
    );
    expect(push.status).toBe(200);
    const pull = await app.request('/api/v1/sync/pull?since=0', {
      headers: authHeader(member.deviceId, member.secret),
    });
    const plj = (await pull.json()) as {
      data: { changes: { entityType: string; entityId: string }[] };
    };
    expect(plj.data.changes.find((c) => c.entityType === 'pantry_quantity')?.entityId).toBe(partId);

    await cleanup();
  });

  it('行の編集と在庫の持ち分を別端末が同時に push しても、どちらも残る（S2-B・設計 §5-3）', async () => {
    // UI の同時タップはエミュレータが不安定で取り切れないので、**同じ不変条件を protocol 層で固定する**。
    // 行（LWW・updated_at を進める）と持ち分（単一書き手）は別エンティティなので競合しない、が要点。
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { deviceId: string; deviceSecret: string; inviteCode: string };
    };
    owner = { deviceId: cj.data.deviceId, secret: cj.data.deviceSecret };
    const joined = await post('/api/v1/sync/groups/join', { inviteCode: cj.data.inviteCode });
    const jj = (await joined.json()) as { data: { deviceId: string; deviceSecret: string } };
    member = { deviceId: jj.data.deviceId, secret: jj.data.deviceSecret };

    const itemId = '3c9e77aa-1111-4222-8333-444455556666';
    const epoch = 1787376676434;
    const rowPayload = (expiresOn: string, updatedAt: string) =>
      JSON.stringify({
        schemaVersion: 3,
        entity: 'pantry_item',
        item: {
          id: itemId,
          name: 'SaltA',
          nameNormalized: 'salta',
          quantity: 1,
          unit: null,
          lowStockThreshold: null,
          janCode: null,
          groupName: null,
          expiresOn,
          createdAt: '2026-08-20T00:00:00.000Z',
          updatedAt,
          quantityBase: null,
          quantityEpoch: epoch,
        },
      });
    const partId = `${itemId}:${member.deviceId}`;

    // 2 端末が「ほぼ同時」に押す: A = 行の編集（期限）、B = 持ち分（−1）
    const [rowRes, partRes] = await Promise.all([
      post(
        '/api/v1/sync/push',
        {
          changes: [
            {
              entityType: 'pantry_item',
              entityId: itemId,
              payload: rowPayload('2027-06-15', '2026-08-23T10:00:00.000Z'),
              clientUpdatedAt: '2026-08-23T10:00:00.000Z',
              deleted: false,
            },
          ],
        },
        authHeader(owner.deviceId, owner.secret),
      ),
      post(
        '/api/v1/sync/push',
        {
          changes: [
            {
              entityType: 'pantry_quantity',
              entityId: partId,
              payload: JSON.stringify({
                schemaVersion: 3,
                entity: 'pantry_quantity',
                item: {
                  id: partId,
                  itemId,
                  deviceId: member.deviceId,
                  net: -1,
                  epoch,
                  updatedAt: '2026-08-23T10:00:00.100Z',
                },
              }),
              clientUpdatedAt: '2026-08-23T10:00:00.100Z',
              deleted: false,
            },
          ],
        },
        authHeader(member.deviceId, member.secret),
      ),
    ]);
    expect(rowRes.status).toBe(200);
    expect(partRes.status).toBe(200);

    // 3 台目から見て、行の編集も持ち分も両方届く（片方が消えない）
    const third = await post('/api/v1/sync/groups/join', { inviteCode: cj.data.inviteCode });
    const tj = (await third.json()) as { data: { deviceId: string; deviceSecret: string } };
    const pull = await app.request('/api/v1/sync/pull?since=0', {
      headers: authHeader(tj.data.deviceId, tj.data.deviceSecret),
    });
    const plj = (await pull.json()) as {
      data: { changes: { entityType: string; entityId: string; payload: string }[] };
    };
    const row = plj.data.changes.find((c) => c.entityId === itemId);
    const part = plj.data.changes.find((c) => c.entityId === partId);
    expect(row).toBeDefined();
    expect(part).toBeDefined();
    if (!row || !part) return;
    // 行は期限が入り、数量の権威（base/epoch）は行 LWW と独立に保たれている
    const rowItem = (JSON.parse(row.payload) as { item: Record<string, unknown> }).item;
    expect(rowItem['expiresOn']).toBe('2027-06-15');
    expect(rowItem['quantityEpoch']).toBe(epoch);
    // 持ち分は同じ世代のまま
    const partItem = (JSON.parse(part.payload) as { item: Record<string, unknown> }).item;
    expect(partItem['net']).toBe(-1);
    expect(partItem['epoch']).toBe(epoch);

    await cleanup();
  });

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

  it('買い物・在庫を含む変更は 1 分で通す（買い物中に効くのが価値なので）', () => {
    const base = Date.parse('2026-08-21T10:00:00.000Z');
    expect(takeNotifySlot('group-1', base, true)).toBe(true);
    expect(takeNotifySlot('group-1', base + 30_000, true)).toBe(false);
    expect(takeNotifySlot('group-1', base + 60_000, true)).toBe(true);
  });

  it('急ぎ扱いになるのは買い物・在庫（持ち分を含む）だけ', () => {
    expect(isUrgentChange(['recipe', 'recipe_book'])).toBe(false);
    expect(isUrgentChange(['recipe', 'shopping_item'])).toBe(true);
    expect(isUrgentChange(['pantry_item'])).toBe(true);
    expect(isUrgentChange(['pantry_quantity'])).toBe(true); // S2-B: タップだけの push
    expect(isUrgentChange(['name_alias'])).toBe(false);
  });
});
