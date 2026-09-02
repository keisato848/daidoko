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
  createSyncGroup,
  deleteSyncGroup,
  fetchSyncMe,
  getStoredCredentials,
  getSyncState,
  inviteLinkUrl,
  joinSyncGroup,
  leaveSyncGroup,
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
