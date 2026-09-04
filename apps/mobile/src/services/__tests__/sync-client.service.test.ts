/**
 * 同期クライアント（S0）。固定したいこと:
 *
 * 1. **クレデンシャルの出入り** — 作成/参加で secure-store に入り、離脱/削除/無効化で消える。
 *    「抜けたのに端末に鍵が残る」「グループが消えたのに参加中表示」を作らない
 * 2. **失敗は必ず SyncError** — サーバーが古い(503)・オフライン・未知エラーでも
 *    生の例外や文言を上に漏らさない（Issue #202 の方針）
 * 3. **既参加ガード** — 参加中の作成/参加は旧クレデンシャルを黙って捨てずに ALREADY_JOINED
 */
jest.mock('../../db/client', () => ({ isNativePlatform: true }));

const mockMemory = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockMemory.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockMemory.delete(key);
  }),
}));

import {
  SyncError,
  createAdditionalSyncGroup,
  createSyncGroup,
  deleteSyncGroup,
  fetchSyncMe,
  getStoredCredentials,
  getSyncState,
  inviteLinkUrl,
  joinAdditionalSyncGroup,
  joinSyncGroup,
  leaveAdditionalSyncGroup,
  leaveSyncGroup,
  listSyncGroups,
  pullSyncChanges,
  pushSyncChanges,
} from '../sync-client.service';

const CREDS = { groupId: 'g1', deviceId: 'd1', deviceSecret: 's1' };

function mockFetchOnce(status: number, body: unknown): void {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

async function expectSyncError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'SyncError', code });
}

beforeEach(() => {
  mockMemory.clear();
  global.fetch = jest.fn();
});

describe('クレデンシャルの出入り', () => {
  it('グループ作成 → secure-store に保存され joined になる', async () => {
    mockFetchOnce(201, {
      ok: true,
      data: { ...CREDS, inviteCode: 'ABCD2345', inviteExpiresAt: '2026-08-22T00:00:00Z' },
    });
    const created = await createSyncGroup('けい');
    expect(created.inviteCode).toBe('ABCD2345');
    expect(await getStoredCredentials()).toEqual(CREDS);
    expect((await getSyncState()).kind).toBe('joined');
  });

  it('参加失敗（コード違い）では何も保存しない', async () => {
    mockFetchOnce(404, { ok: false, error: 'INVITE_INVALID' });
    await expectSyncError(joinSyncGroup('ZZZZZZZZ', null), 'INVITE_INVALID');
    expect(await getStoredCredentials()).toBeNull();
  });

  it('離脱でクレデンシャルが消える', async () => {
    mockMemory.set('sync_credentials_v1', JSON.stringify(CREDS));
    mockFetchOnce(200, { ok: true });
    await leaveSyncGroup();
    expect(await getStoredCredentials()).toBeNull();
  });

  it('サーバー側で既に消えていても（401）、離脱はローカルの鍵を破棄して成功扱い', async () => {
    mockMemory.set('sync_credentials_v1', JSON.stringify(CREDS));
    mockFetchOnce(401, { ok: false, error: 'AUTH_INVALID' });
    await leaveSyncGroup();
    expect(await getStoredCredentials()).toBeNull();
  });

  it('/me が 401 ならクレデンシャルを破棄する（未参加表示に自己修復できる）', async () => {
    mockMemory.set('sync_credentials_v1', JSON.stringify(CREDS));
    mockFetchOnce(401, { ok: false, error: 'AUTH_INVALID' });
    await expectSyncError(fetchSyncMe(), 'AUTH_INVALID');
    expect(await getStoredCredentials()).toBeNull();
  });

  it('グループ削除も成功時に鍵を破棄する', async () => {
    mockMemory.set('sync_credentials_v1', JSON.stringify(CREDS));
    mockFetchOnce(200, { ok: true });
    await deleteSyncGroup();
    expect(await getStoredCredentials()).toBeNull();
  });
});

describe('失敗の写し方', () => {
  it('サーバーが古い/DB 未接続（503 SYNC_DISABLED）→ SYNC_UNAVAILABLE', async () => {
    mockFetchOnce(503, { ok: false, error: 'SYNC_DISABLED' });
    await expectSyncError(createSyncGroup(null), 'SYNC_UNAVAILABLE');
  });

  it('オフライン（fetch 例外）→ NETWORK。生の例外を漏らさない', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));
    await expectSyncError(createSyncGroup(null), 'NETWORK');
  });

  it('未知のエラー・壊れた応答 → SERVER', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });
    await expectSyncError(createSyncGroup(null), 'SERVER');
  });

  it('期限切れ・定員・レート制限はコードのまま届く', async () => {
    mockFetchOnce(410, { ok: false, error: 'INVITE_EXPIRED' });
    await expectSyncError(joinSyncGroup('AAAA2222', null), 'INVITE_EXPIRED');
    mockFetchOnce(409, { ok: false, error: 'GROUP_FULL' });
    await expectSyncError(joinSyncGroup('AAAA2222', null), 'GROUP_FULL');
    mockFetchOnce(429, { ok: false, error: 'RATE_LIMITED' });
    await expectSyncError(joinSyncGroup('AAAA2222', null), 'RATE_LIMITED');
  });
});

describe('既参加ガード', () => {
  it('参加中の作成・参加は ALREADY_JOINED（旧クレデンシャルを黙って捨てない）', async () => {
    mockMemory.set('sync_credentials_v1', JSON.stringify(CREDS));
    await expectSyncError(createSyncGroup(null), 'ALREADY_JOINED');
    await expectSyncError(joinSyncGroup('AAAA2222', null), 'ALREADY_JOINED');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await getStoredCredentials()).toEqual(CREDS);
  });
});

describe('SyncError', () => {
  it('instanceof で判別できる', async () => {
    mockFetchOnce(404, { ok: false, error: 'INVITE_INVALID' });
    try {
      await joinSyncGroup('ZZZZZZZZ', null);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SyncError);
    }
  });
});

describe('招待リンク（§2-2b）', () => {
  it('API と同じホストの /j/<code>（api/v1 は含めない）', () => {
    const url = inviteLinkUrl('ABCD2345');
    expect(url).toMatch(/^https?:\/\/[^/]+\/j\/ABCD2345$/);
    expect(url).not.toContain('/api/v1');
  });
});

describe('多グループ（G-2a — 設計 §12-2）', () => {
  const change = {
    entityType: 'recipe',
    entityId: 'r1',
    payload: '{}',
    clientUpdatedAt: '2026-09-01T00:00:00.000Z',
    deleted: false,
  };

  it('groupId 指定で x-sync-group が付き、未指定なら付かない（現行と同一リクエスト＝互換の要）', async () => {
    mockMemory.set('sync_credentials_v1', JSON.stringify(CREDS));

    mockFetchOnce(200, { ok: true, data: { applied: 1, latestSeq: 1 } });
    await pushSyncChanges([change], 'g2');
    const withGroup = (global.fetch as jest.Mock).mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(withGroup.headers['x-sync-group']).toBe('g2');

    mockFetchOnce(200, { ok: true, data: { applied: 1, latestSeq: 1 } });
    await pushSyncChanges([change]);
    const withoutGroup = (global.fetch as jest.Mock).mock.calls[1][1] as {
      headers: Record<string, string>;
    };
    expect('x-sync-group' in withoutGroup.headers).toBe(false);
  });

  it('groupId 指定の 401 ではクレデンシャルを破棄しない（外されたのはそのグループだけかもしれない）', async () => {
    mockMemory.set('sync_credentials_v1', JSON.stringify(CREDS));
    mockFetchOnce(401, { ok: false, error: 'AUTH_INVALID' });

    await expectSyncError(pullSyncChanges(0, 500, 'g2'), 'AUTH_INVALID');

    expect(await getStoredCredentials()).toEqual(CREDS);
  });

  it('groupId 未指定の 401 は従来どおりクレデンシャルを破棄する', async () => {
    mockMemory.set('sync_credentials_v1', JSON.stringify(CREDS));
    mockFetchOnce(401, { ok: false, error: 'AUTH_INVALID' });

    await expectSyncError(pushSyncChanges([change]), 'AUTH_INVALID');

    expect(await getStoredCredentials()).toBeNull();
  });

  it('参加グループの一覧を取得する（GET /sync/me/groups）', async () => {
    mockMemory.set('sync_credentials_v1', JSON.stringify(CREDS));
    mockFetchOnce(200, {
      ok: true,
      data: {
        groups: [{ groupId: 'g1', name: null, scope: 'all', isOwner: true, memberCount: 2 }],
      },
    });

    const groups = await listSyncGroups();

    expect(groups).toEqual([
      { groupId: 'g1', name: null, scope: 'all', isOwner: true, memberCount: 2 },
    ]);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('/sync/me/groups');
  });

  it('未参加で一覧を求めたら AUTH_INVALID（サーバーを叩かない）', async () => {
    await expectSyncError(listSyncGroups(), 'AUTH_INVALID');
    expect(global.fetch as jest.Mock).not.toHaveBeenCalled();
  });
});

/**
 * 既存端末の追加グループ（G-2b — §12-2）。固定したいこと:
 * - 作成/参加は Authorization つき・**端末の鍵（secure-store）は書き換えない**
 * - 古いサーバーが新端末を作ってしまったら（deviceSecret が返る）即離脱して
 *   SYNC_UNAVAILABLE — 誰からも消せない幽霊端末を残さない
 * - 追加グループからの離脱は x-sync-group つき。401（もう外されている）は成功扱い
 */
describe('追加グループの作成・参加・離脱（G-2b）', () => {
  beforeEach(() => {
    mockMemory.set('sync_credentials_v1', JSON.stringify(CREDS));
  });

  it('作成は Authorization つき POST /groups。鍵は変えない', async () => {
    mockFetchOnce(201, {
      ok: true,
      data: {
        groupId: 'g2',
        deviceId: 'd1',
        deviceSecret: '',
        inviteCode: 'CODE1234',
        inviteExpiresAt: '2026-09-05T00:00:00.000Z',
      },
    });

    const created = await createAdditionalSyncGroup('娘と', 'recipes');

    expect(created.groupId).toBe('g2');
    expect(created.inviteCode).toBe('CODE1234');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/sync/groups');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer d1.s1');
    expect(JSON.parse(String(init.body))).toEqual({ name: '娘と', scope: 'recipes' });
    expect(await getStoredCredentials()).toEqual(CREDS); // 鍵はそのまま
  });

  it('参加は開示情報（groupName/scope/memberCount）を返し、鍵は変えない', async () => {
    mockFetchOnce(200, {
      ok: true,
      data: {
        groupId: 'g2',
        deviceId: 'd1',
        deviceSecret: '',
        memberCount: 2,
        groupName: '娘と',
        scope: 'recipes',
      },
    });

    const joined = await joinAdditionalSyncGroup('CODE1234');

    expect(joined).toMatchObject({
      groupId: 'g2',
      memberCount: 2,
      groupName: '娘と',
      scope: 'recipes',
    });
    expect(await getStoredCredentials()).toEqual(CREDS);
  });

  it('**古いサーバーが新端末を作ってしまったら**その鍵で即離脱し SYNC_UNAVAILABLE', async () => {
    mockFetchOnce(200, {
      ok: true,
      data: { groupId: 'g9', deviceId: 'd-ghost', deviceSecret: 's-ghost', memberCount: 2 },
    });
    mockFetchOnce(200, { ok: true }); // 幽霊端末の DELETE /devices/me

    await expectSyncError(joinAdditionalSyncGroup('CODE1234'), 'SYNC_UNAVAILABLE');

    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    const [url, init] = calls[1] as [string, RequestInit];
    expect(String(url)).toContain('/sync/devices/me');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer d-ghost.s-ghost');
    expect(await getStoredCredentials()).toEqual(CREDS); // 自分の鍵は無傷
  });

  it('追加グループからの離脱は x-sync-group つき。401 でも鍵を破棄しない', async () => {
    mockFetchOnce(401, { ok: false, error: 'AUTH_INVALID' });

    await leaveAdditionalSyncGroup('g2'); // 投げない（もう外されている＝目的は達成）

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-sync-group']).toBe('g2');
    expect(await getStoredCredentials()).toEqual(CREDS);
  });

  it('未参加からの追加作成は AUTH_INVALID（サーバーを叩かない）', async () => {
    mockMemory.clear();
    await expectSyncError(createAdditionalSyncGroup('x', 'all'), 'AUTH_INVALID');
    expect(global.fetch as jest.Mock).not.toHaveBeenCalled();
  });
});
