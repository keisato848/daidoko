/**
 * G-1: 多グループ（docs/クラウド同期設計.md §12）のルートテスト。
 *
 * 実 PostgreSQL があるときだけ実行（`TEST_DATABASE_URL` — sync.route.test.ts と同じ）。
 * ここで守るもの:
 * - 既存端末が 2 つ目以降のグループを作成/参加できる（端末・秘密は増えない）
 * - `x-sync-group` でグループを切り替え、push/pull がグループ間で漏れない
 * - scope='recipes' の門番（push 400・pull に scope 外を降ろさない）
 * - 片方のグループを離脱しても端末はもう片方で生きる（主グループの付け替え）
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { closeSyncStoreForTesting } from '../lib/sync-store.js';
import { resetSyncRateLimitForTesting } from '../routes/sync.js';

const TEST_DB = process.env['TEST_DATABASE_URL'];

function authHeader(deviceId: string, secret: string): Record<string, string> {
  return { Authorization: `Bearer ${deviceId}.${secret}` };
}

function groupHeader(groupId: string): Record<string, string> {
  return { 'x-sync-group': groupId };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function deleteGroupVia(auth: Record<string, string>, groupId?: string) {
  await app.request('/api/v1/sync/group', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...auth,
      ...(groupId ? groupHeader(groupId) : {}),
    },
    body: JSON.stringify({ confirm: true }),
  });
}

function change(entityType: string, entityId: string, payload: object) {
  return {
    entityType,
    entityId,
    payload: JSON.stringify(payload),
    clientUpdatedAt: new Date().toISOString(),
    deleted: false,
  };
}

describe.runIf(Boolean(TEST_DB))('G-1: 多グループ（実 PostgreSQL）', () => {
  beforeAll(() => {
    process.env['SYNC_DATABASE_URL'] = TEST_DB as string;
  });
  beforeEach(() => {
    resetSyncRateLimitForTesting();
  });
  afterAll(async () => {
    delete process.env['SYNC_DATABASE_URL'];
    await closeSyncStoreForTesting();
  });

  async function createFirstGroup() {
    const created = await post('/api/v1/sync/groups', {});
    const cj = (await created.json()) as {
      data: { groupId: string; deviceId: string; deviceSecret: string; inviteCode: string };
    };
    return cj.data;
  }

  it('既存端末が 2 つ目のグループを作れる（端末・秘密は発行されない）', async () => {
    const first = await createFirstGroup();
    const auth = authHeader(first.deviceId, first.deviceSecret);

    const second = await post('/api/v1/sync/groups', { name: 'レシピ友', scope: 'recipes' }, auth);
    expect(second.status).toBe(201);
    const sj = (await second.json()) as {
      data: { groupId: string; deviceId: string; deviceSecret: string };
    };
    expect(sj.data.deviceId).toBe(first.deviceId);
    expect(sj.data.deviceSecret).toBe('');

    const groups = await app.request('/api/v1/sync/me/groups', { headers: auth });
    const gj = (await groups.json()) as {
      data: { groups: { groupId: string; name: string | null; scope: string; isOwner: boolean }[] };
    };
    expect(gj.data.groups).toHaveLength(2);
    expect(gj.data.groups.find((g) => g.groupId === sj.data.groupId)).toMatchObject({
      name: 'レシピ友',
      scope: 'recipes',
      isOwner: true,
    });

    await deleteGroupVia(auth, sj.data.groupId);
    await deleteGroupVia(auth);
  });

  it('x-sync-group でグループを切り替え、push/pull が分離される', async () => {
    const first = await createFirstGroup();
    const auth = authHeader(first.deviceId, first.deviceSecret);
    const second = (await (
      await post('/api/v1/sync/groups', { name: '第二', scope: 'all' }, auth)
    ).json()) as { data: { groupId: string } };

    const pushed = await post(
      '/api/v1/sync/push',
      { changes: [change('recipe', 'only-second', { title: '第二だけ' })] },
      { ...auth, ...groupHeader(second.data.groupId) },
    );
    expect(pushed.status).toBe(200);

    // 主グループ（ヘッダ無し）の pull には現れない
    const firstPull = (await (
      await app.request('/api/v1/sync/pull?since=0', { headers: auth })
    ).json()) as { data: { changes: { entityId: string }[] } };
    expect(firstPull.data.changes.map((chg) => chg.entityId)).not.toContain('only-second');

    // 第二グループの pull には現れる
    const secondPull = (await (
      await app.request('/api/v1/sync/pull?since=0', {
        headers: { ...auth, ...groupHeader(second.data.groupId) },
      })
    ).json()) as { data: { changes: { entityId: string }[] } };
    expect(secondPull.data.changes.map((chg) => chg.entityId)).toContain('only-second');

    // membership の無いグループ指定は 401（存在も漏らさない）
    const bogus = await app.request('/api/v1/sync/pull?since=0', {
      headers: { ...auth, ...groupHeader('no-such-group') },
    });
    expect(bogus.status).toBe(401);

    await deleteGroupVia(auth, second.data.groupId);
    await deleteGroupVia(auth);
  });

  it("scope='recipes' はレシピ系以外の push を 400 で弾き、pull にも降ろさない", async () => {
    const first = await createFirstGroup();
    const auth = authHeader(first.deviceId, first.deviceSecret);
    const recipes = (await (
      await post('/api/v1/sync/groups', { name: 'レシピ限定', scope: 'recipes' }, auth)
    ).json()) as { data: { groupId: string } };
    const gh = groupHeader(recipes.data.groupId);

    const rejected = await post(
      '/api/v1/sync/push',
      { changes: [change('shopping_item', 'x1', { name: '牛乳' })] },
      { ...auth, ...gh },
    );
    expect(rejected.status).toBe(400);
    expect(((await rejected.json()) as { error: string }).error).toBe('SCOPE_MISMATCH');

    const okPush = await post(
      '/api/v1/sync/push',
      { changes: [change('recipe', 'r1', { title: '通る' })] },
      { ...auth, ...gh },
    );
    expect(okPush.status).toBe(200);

    // 'all' で pantry を入れてから scope を 'recipes' に絞る → pull に scope 外が現れない
    const mixed = (await (
      await post('/api/v1/sync/groups', { name: '混在', scope: 'all' }, auth)
    ).json()) as { data: { groupId: string } };
    const mh = groupHeader(mixed.data.groupId);
    await post(
      '/api/v1/sync/push',
      {
        changes: [
          change('pantry_item', 'p1', { name: '大根' }),
          change('recipe', 'r2', { title: 'レシピ' }),
        ],
      },
      { ...auth, ...mh },
    );
    const patched = await app.request('/api/v1/sync/group', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth, ...mh },
      body: JSON.stringify({ scope: 'recipes' }),
    });
    expect(patched.status).toBe(200);
    const pull = (await (
      await app.request('/api/v1/sync/pull?since=0', { headers: { ...auth, ...mh } })
    ).json()) as { data: { changes: { entityType: string }[] } };
    expect(pull.data.changes.map((chg) => chg.entityType)).toEqual(['recipe']);

    await deleteGroupVia(auth, recipes.data.groupId);
    await deleteGroupVia(auth, mixed.data.groupId);
    await deleteGroupVia(auth);
  });

  it('片方のグループを離脱しても、端末はもう片方で生き続ける（主グループの付け替え）', async () => {
    const first = await createFirstGroup();
    const auth = authHeader(first.deviceId, first.deviceSecret);
    const second = (await (
      await post('/api/v1/sync/groups', { name: '残す方', scope: 'all' }, auth)
    ).json()) as { data: { groupId: string } };

    const left = await app.request('/api/v1/sync/devices/me', {
      method: 'DELETE',
      headers: auth,
    });
    expect(left.status).toBe(200);

    const me = await app.request('/api/v1/sync/me', { headers: auth });
    expect(me.status).toBe(200);
    const mj = (await me.json()) as { data: { groupId: string } };
    expect(mj.data.groupId).toBe(second.data.groupId);

    await deleteGroupVia(auth);
  });
});
