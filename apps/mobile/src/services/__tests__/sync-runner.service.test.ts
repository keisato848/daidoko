/**
 * 同期の実行役（S1 — docs/クラウド同期設計.md §5-1b）。
 *
 * 固定したいこと（多くはレビューで見つかった実際の欠陥の再発防止）:
 * - 未参加なら何もしない（サーバーを叩かない）
 * - 送れた分だけ待ち行列から消す。**一時障害では絶対に捨てない**
 * - **自端末が押した変更は適用しない**。ただし 0 から取り直すときは適用する
 * - カーソルは**受け取った変更の seq までしか進めない**（latestSeq へ飛ばさない）
 * - 書き込みに失敗した変更より先へカーソルを進めない
 */
jest.mock('../../db/client', () => ({ isNativePlatform: true, getDb: jest.fn() }));

const mockGetStoredCredentials = jest.fn();
const mockPushSyncChanges = jest.fn();
const mockPullSyncChanges = jest.fn();
const mockRegisterSyncPushToken = jest.fn();

// SyncError はモックの中で作る。外の class を参照すると、モック生成時点では
// まだ評価されていない（TDZ）ので undefined になり、instanceof の分岐が黙って死ぬ
jest.mock('../sync-client.service', () => {
  class SyncError extends Error {
    code: string;
    constructor(mockCode: string) {
      super(`sync: ${mockCode}`);
      this.name = 'SyncError';
      this.code = mockCode;
    }
  }
  return {
    SyncError,
    getStoredCredentials: (...args: unknown[]) => mockGetStoredCredentials(...args),
    pushSyncChanges: (...args: unknown[]) => mockPushSyncChanges(...args),
    pullSyncChanges: (...args: unknown[]) => mockPullSyncChanges(...args),
    registerSyncPushToken: (...args: unknown[]) => mockRegisterSyncPushToken(...args),
  };
});

const mockBuildOutgoingChange = jest.fn();
const mockApplyIncomingChange = jest.fn();
const mockListAllSyncableEntities = jest.fn();

jest.mock('../sync-entities.service', () => ({
  buildOutgoingChange: (...args: unknown[]) => mockBuildOutgoingChange(...args),
  applyIncomingChange: (...args: unknown[]) => mockApplyIncomingChange(...args),
  listAllSyncableEntities: (...args: unknown[]) => mockListAllSyncableEntities(...args),
}));

const mockListSyncQueue = jest.fn();
const mockRemoveSent = jest.fn();
const mockBumpRetry = jest.fn();
const mockClearQueue = jest.fn();
const mockEnqueueEntities = jest.fn();
const mockSetQueueListener = jest.fn();

jest.mock('../sync-queue.service', () => ({
  SYNC_PUSH_BATCH_SIZE: 200,
  listSyncQueue: (...args: unknown[]) => mockListSyncQueue(...args),
  removeSentSyncQueueEntries: (...args: unknown[]) => mockRemoveSent(...args),
  bumpSyncQueueRetry: (...args: unknown[]) => mockBumpRetry(...args),
  clearSyncQueue: (...args: unknown[]) => mockClearQueue(...args),
  enqueueSyncEntities: (...args: unknown[]) => mockEnqueueEntities(...args),
  setSyncQueueListener: (...args: unknown[]) => mockSetQueueListener(...args),
}));

let mockMeta: Record<string, string> = {};
jest.mock('../app-meta.service', () => ({
  getAppMeta: jest.fn(async (key: string) => mockMeta[key] ?? null),
  setAppMeta: jest.fn(async (key: string, value: string) => {
    mockMeta[key] = value;
  }),
}));

const mockGetExpoPushToken = jest.fn();
jest.mock('../notification.service', () => ({
  getExpoPushToken: (...args: unknown[]) => mockGetExpoPushToken(...args),
}));

import { SyncError } from '../sync-client.service';
import { SYNC_PAYLOAD_SCHEMA_VERSION } from '../sync-payload';
import {
  onLocalDataReplaced,
  onSyncGroupJoined,
  onSyncGroupLeft,
  resetSyncRunnerForTesting,
  runSync,
} from '../sync-runner.service';
import { useSyncStore } from '../../stores/sync.store';

const CREDENTIALS = { groupId: 'group-1', deviceId: 'device-me', deviceSecret: 'secret' };

function queueEntry(
  entityId: string,
  entityType = 'recipe',
  queuedAt = '2026-08-21T10:00:00.000Z',
) {
  return { entityType, entityId, queuedAt, retryCount: 0 };
}

function outgoing(entityId: string, entityType = 'recipe') {
  return {
    kind: 'change' as const,
    change: {
      entityType,
      entityId,
      payload: JSON.stringify({ schemaVersion: 1, entity: entityType, id: entityId }),
      clientUpdatedAt: '2026-08-21T10:00:00.000Z',
      deleted: false,
    },
  };
}

function incoming(entityId: string, seq: number, updatedByDevice: string) {
  return {
    entityType: 'recipe',
    entityId,
    payload: '{}',
    clientUpdatedAt: '2026-08-21T10:00:00.000Z',
    deleted: false,
    seq,
    updatedByDevice,
  };
}

function emptyPull(latestSeq = 0) {
  return { changes: [], deltas: [], latestSeq, hasMore: false };
}

function storedCursor(): { groupId: string; seq: number; payloadVersion: number } {
  return JSON.parse(mockMeta['sync_cursor']);
}

function cursorValue(groupId: string, seq: number, payloadVersion = SYNC_PAYLOAD_SCHEMA_VERSION) {
  return JSON.stringify({ groupId, seq, payloadVersion });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMeta = {};
  resetSyncRunnerForTesting();
  useSyncStore.getState().resetForTesting();
  mockGetStoredCredentials.mockResolvedValue(CREDENTIALS);
  mockListSyncQueue.mockResolvedValue([]);
  mockPullSyncChanges.mockResolvedValue(emptyPull());
  mockPushSyncChanges.mockResolvedValue({ applied: 0, latestSeq: 0 });
  mockApplyIncomingChange.mockResolvedValue('applied');
  mockListAllSyncableEntities.mockResolvedValue([]);
  mockGetExpoPushToken.mockResolvedValue(null);
  mockRemoveSent.mockResolvedValue(undefined);
  mockBumpRetry.mockResolvedValue(undefined);
  mockClearQueue.mockResolvedValue(undefined);
  mockEnqueueEntities.mockResolvedValue(undefined);
});

describe('runSync — 未参加', () => {
  it('クレデンシャルが無ければサーバーを一切叩かない', async () => {
    mockGetStoredCredentials.mockResolvedValue(null);

    await runSync();

    expect(mockPushSyncChanges).not.toHaveBeenCalled();
    expect(mockPullSyncChanges).not.toHaveBeenCalled();
  });
});

describe('runSync — push', () => {
  it('待ち行列を payload にして送り、送れた分を消す', async () => {
    mockListSyncQueue
      .mockResolvedValueOnce([queueEntry('recipe-1'), queueEntry('book-1', 'recipe_book')])
      .mockResolvedValue([]);
    mockBuildOutgoingChange
      .mockResolvedValueOnce(outgoing('recipe-1'))
      .mockResolvedValueOnce(outgoing('book-1', 'recipe_book'));

    await runSync();

    expect(mockPushSyncChanges).toHaveBeenCalledTimes(1);
    const sent = mockPushSyncChanges.mock.calls[0][0];
    expect(sent).toHaveLength(2);
    expect(sent[0].entityId).toBe('recipe-1');
    expect(mockRemoveSent).toHaveBeenCalledWith([
      expect.objectContaining({ entityId: 'recipe-1' }),
      expect.objectContaining({ entityId: 'book-1' }),
    ]);
  });

  it('積んだ時刻を組み立てへ渡す（削除の時刻＝消した時刻にするため）', async () => {
    mockListSyncQueue
      .mockResolvedValueOnce([queueEntry('book-1', 'recipe_book', '2026-08-20T01:02:03.000Z')])
      .mockResolvedValue([]);
    mockBuildOutgoingChange.mockResolvedValue(outgoing('book-1', 'recipe_book'));

    await runSync();

    expect(mockBuildOutgoingChange).toHaveBeenCalledWith(
      'recipe_book',
      'book-1',
      '2026-08-20T01:02:03.000Z',
    );
  });

  it('種別が分からない行だけ捨てる', async () => {
    mockListSyncQueue
      .mockResolvedValueOnce([queueEntry('gone', 'unknown_kind')])
      .mockResolvedValue([]);
    mockBuildOutgoingChange.mockResolvedValue({ kind: 'unsupported' });

    await runSync();

    expect(mockPushSyncChanges).not.toHaveBeenCalled();
    expect(mockRemoveSent).toHaveBeenCalledWith([expect.objectContaining({ entityId: 'gone' })]);
  });

  it('組み立ての一時的な失敗では捨てない（次の同期でやり直す）', async () => {
    mockListSyncQueue.mockResolvedValueOnce([queueEntry('recipe-1')]).mockResolvedValue([]);
    mockBuildOutgoingChange.mockResolvedValue({ kind: 'error' });

    await runSync();

    expect(mockPushSyncChanges).not.toHaveBeenCalled();
    expect(mockRemoveSent).not.toHaveBeenCalled();
  });

  it('大きすぎる 1 件は送らない（バッチ全体を巻き添えにしない）', async () => {
    mockListSyncQueue
      .mockResolvedValueOnce([queueEntry('huge'), queueEntry('recipe-1')])
      .mockResolvedValue([]);
    mockBuildOutgoingChange
      .mockResolvedValueOnce({
        kind: 'change',
        change: { ...outgoing('huge').change, payload: 'x'.repeat(300_000) },
      })
      .mockResolvedValueOnce(outgoing('recipe-1'));

    await runSync();

    const sent = mockPushSyncChanges.mock.calls[0][0];
    expect(sent.map((c: { entityId: string }) => c.entityId)).toEqual(['recipe-1']);
    expect(mockRemoveSent).toHaveBeenCalledWith([expect.objectContaining({ entityId: 'huge' })]);
  });

  it('通信断なら待ち行列を消さず、失敗回数だけ増やす', async () => {
    mockListSyncQueue.mockResolvedValue([queueEntry('recipe-1')]);
    mockBuildOutgoingChange.mockResolvedValue(outgoing('recipe-1'));
    mockPushSyncChanges.mockRejectedValue(new SyncError('NETWORK'));

    await runSync();

    expect(mockBumpRetry).toHaveBeenCalled();
    expect(mockRemoveSent).not.toHaveBeenCalled();
    // push が落ちたら pull もしない（同じ通信断なので）
    expect(mockPullSyncChanges).not.toHaveBeenCalled();
  });

  it('サーバーの一時障害（502 等）では 1 件も捨てない', async () => {
    mockListSyncQueue.mockResolvedValue([queueEntry('recipe-1'), queueEntry('recipe-2')]);
    mockBuildOutgoingChange
      .mockResolvedValueOnce(outgoing('recipe-1'))
      .mockResolvedValueOnce(outgoing('recipe-2'));
    mockPushSyncChanges.mockRejectedValue(new SyncError('SERVER'));

    await runSync();

    expect(mockRemoveSent).not.toHaveBeenCalled();
    expect(mockBumpRetry).toHaveBeenCalled();
    // 1 件ずつのやり直しにも入らない（一時障害は分割しても通らない）
    expect(mockPushSyncChanges).toHaveBeenCalledTimes(1);
  });

  it('内容を拒否されたら 1 件ずつ送り直し、通らない 1 件だけ捨てる', async () => {
    mockListSyncQueue
      .mockResolvedValueOnce([queueEntry('poison'), queueEntry('good')])
      .mockResolvedValue([]);
    mockBuildOutgoingChange
      .mockResolvedValueOnce(outgoing('poison'))
      .mockResolvedValueOnce(outgoing('good'));
    mockPushSyncChanges
      .mockRejectedValueOnce(new SyncError('SERVER_REJECTED')) // バッチ
      .mockRejectedValueOnce(new SyncError('SERVER_REJECTED')) // poison 単体
      .mockResolvedValueOnce({ applied: 1, latestSeq: 1 }); // good 単体

    await runSync();

    expect(mockPushSyncChanges).toHaveBeenCalledTimes(3);
    const removed = mockRemoveSent.mock.calls.flatMap((call) => call[0]);
    expect(removed.map((entry: { entityId: string }) => entry.entityId)).toEqual([
      'poison',
      'good',
    ]);
  });

  it('待ち行列が 1 バッチに収まらなければ続きも送る（参加直後に一部だけ届く、を作らない）', async () => {
    mockListSyncQueue
      .mockResolvedValueOnce([queueEntry('recipe-1')])
      .mockResolvedValueOnce([queueEntry('recipe-2')])
      .mockResolvedValue([]);
    mockBuildOutgoingChange
      .mockResolvedValueOnce(outgoing('recipe-1'))
      .mockResolvedValueOnce(outgoing('recipe-2'));

    await runSync();

    expect(mockPushSyncChanges).toHaveBeenCalledTimes(2);
    expect(mockPushSyncChanges.mock.calls[1][0][0].entityId).toBe('recipe-2');
  });
});

describe('runSync — pull', () => {
  it('自端末が押した変更は適用しない', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-1', 1);
    mockPullSyncChanges.mockResolvedValue({
      changes: [incoming('recipe-1', 2, 'device-me'), incoming('recipe-2', 3, 'device-other')],
      deltas: [],
      latestSeq: 3,
      hasMore: false,
    });

    await runSync();

    expect(mockApplyIncomingChange).toHaveBeenCalledTimes(1);
    expect(mockApplyIncomingChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'recipe-2' }),
    );
  });

  it('0 から取り直すときは自端末の分も適用する（バックアップ復元で食い違わない）', async () => {
    mockPullSyncChanges.mockResolvedValue({
      changes: [incoming('recipe-1', 1, 'device-me')],
      deltas: [],
      latestSeq: 1,
      hasMore: false,
    });

    await runSync();

    expect(mockApplyIncomingChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'recipe-1' }),
    );
  });

  it('カーソルを進めて保存する（次回はその続きから）', async () => {
    mockPullSyncChanges.mockResolvedValue({
      changes: [incoming('recipe-2', 7, 'device-other')],
      deltas: [],
      latestSeq: 7,
      hasMore: false,
    });

    await runSync();

    expect(mockPullSyncChanges).toHaveBeenCalledWith(0);
    expect(storedCursor()).toEqual({
      groupId: 'group-1',
      seq: 7,
      payloadVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
    });
  });

  it('受け取っていない seq へは飛ばさない（pull 中の他端末の push を飛び越さない）', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-1', 5);
    mockPullSyncChanges.mockResolvedValue({
      changes: [incoming('recipe-2', 6, 'device-other')],
      deltas: [],
      latestSeq: 9, // pull の最中に他端末が 7〜9 を押した
      hasMore: false,
    });

    await runSync();

    expect(storedCursor().seq).toBe(6);
  });

  it('変更が 1 件も無ければカーソルは据え置き', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-1', 4);
    mockPullSyncChanges.mockResolvedValue({
      changes: [],
      deltas: [],
      latestSeq: 9,
      hasMore: false,
    });

    await runSync();

    expect(storedCursor().seq).toBe(4);
  });

  it('書き込みに失敗した変更より先へは進めない', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-1', 1);
    mockPullSyncChanges.mockResolvedValue({
      changes: [
        incoming('recipe-a', 2, 'device-other'),
        incoming('recipe-b', 3, 'device-other'),
        incoming('recipe-c', 4, 'device-other'),
      ],
      deltas: [],
      latestSeq: 4,
      hasMore: false,
    });
    mockApplyIncomingChange
      .mockResolvedValueOnce('applied')
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('applied');

    await runSync();

    expect(storedCursor().seq).toBe(2);
  });

  it('保存済みカーソルの続きから取る', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-1', 12);

    await runSync();

    expect(mockPullSyncChanges).toHaveBeenCalledWith(12);
  });

  it('別グループのカーソルは使わない（他人のバックアップ復元対策）', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-other', 99);

    await runSync();

    expect(mockPullSyncChanges).toHaveBeenCalledWith(0);
  });

  it('payload の版が変わったら取り直す（更新前に読み飛ばした分を拾う）', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-1', 42, SYNC_PAYLOAD_SCHEMA_VERSION - 1);

    await runSync();

    expect(mockPullSyncChanges).toHaveBeenCalledWith(0);
  });

  it('hasMore なら続きを取りに行く', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-1', 1);
    mockPullSyncChanges
      .mockResolvedValueOnce({
        changes: [incoming('recipe-1', 5, 'device-other')],
        deltas: [],
        latestSeq: 9,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        changes: [incoming('recipe-2', 9, 'device-other')],
        deltas: [],
        latestSeq: 9,
        hasMore: false,
      });

    await runSync();

    expect(mockPullSyncChanges).toHaveBeenNthCalledWith(1, 1);
    expect(mockPullSyncChanges).toHaveBeenNthCalledWith(2, 5);
    expect(storedCursor().seq).toBe(9);
  });

  it('適用が 1 件でもあれば画面に読み直しの合図を出す', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-1', 0);
    mockPullSyncChanges.mockResolvedValue({
      changes: [incoming('recipe-2', 1, 'device-other')],
      deltas: [],
      latestSeq: 1,
      hasMore: false,
    });

    await runSync();

    expect(useSyncStore.getState().lastAppliedAt).toBeGreaterThan(0);
  });

  it('LWW で負けただけなら合図は出さない（画面のちらつきを作らない）', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-1', 1);
    mockPullSyncChanges.mockResolvedValue({
      changes: [incoming('recipe-2', 2, 'device-other')],
      deltas: [],
      latestSeq: 2,
      hasMore: false,
    });
    mockApplyIncomingChange.mockResolvedValue('skipped');

    await runSync();

    expect(useSyncStore.getState().lastAppliedAt).toBe(0);
  });

  it('通信断でも例外を投げない（画面には出さない）', async () => {
    mockPullSyncChanges.mockRejectedValue(new SyncError('NETWORK'));

    await expect(runSync()).resolves.toBeUndefined();
  });

  it('サーバーが同期未対応（503）でも例外を投げない', async () => {
    mockPullSyncChanges.mockRejectedValue(new SyncError('SYNC_UNAVAILABLE'));

    await expect(runSync()).resolves.toBeUndefined();
  });
});

describe('runSync — push トークン', () => {
  it('取れたら言語つきで登録し、同じトークンなら二度目は登録しない', async () => {
    mockGetExpoPushToken.mockResolvedValue('ExponentPushToken[abc]');

    await runSync();
    await runSync();

    expect(mockRegisterSyncPushToken).toHaveBeenCalledTimes(1);
    expect(mockRegisterSyncPushToken).toHaveBeenCalledWith(
      'ExponentPushToken[abc]',
      expect.stringMatching(/^(ja|en)$/),
    );
  });

  it('トークンは DB に残さない（バックアップに出さない）', async () => {
    mockGetExpoPushToken.mockResolvedValue('ExponentPushToken[abc]');

    await runSync();

    expect(Object.keys(mockMeta)).not.toContain('sync_push_token');
  });

  it('トークンが取れなくても同期は成立する', async () => {
    mockGetExpoPushToken.mockResolvedValue(null);

    await runSync();

    expect(mockRegisterSyncPushToken).not.toHaveBeenCalled();
    expect(mockPullSyncChanges).toHaveBeenCalled();
  });
});

describe('グループの出入り', () => {
  it('参加したら、いまある蔵書を全部積んで同期する', async () => {
    mockListAllSyncableEntities.mockResolvedValue([
      { entityType: 'recipe', entityId: 'recipe-1' },
      { entityType: 'recipe_book', entityId: 'book-1' },
    ]);
    mockMeta['sync_cursor'] = cursorValue('group-old', 42);

    await onSyncGroupJoined();

    expect(mockEnqueueEntities).toHaveBeenCalledWith([
      { entityType: 'recipe', entityId: 'recipe-1' },
      { entityType: 'recipe_book', entityId: 'book-1' },
    ]);
    expect(mockPullSyncChanges).toHaveBeenCalledWith(0);
  });

  it('離脱したら送信待ちとカーソルを捨てる', async () => {
    mockMeta['sync_cursor'] = cursorValue('group-1', 42);

    await onSyncGroupLeft();

    expect(mockClearQueue).toHaveBeenCalled();
    expect(mockMeta['sync_cursor']).toBe('');
  });

  it('バックアップ復元後は取り直し（カーソル 0）＋全件積み直し', async () => {
    mockListAllSyncableEntities.mockResolvedValue([{ entityType: 'recipe', entityId: 'recipe-1' }]);
    mockMeta['sync_cursor'] = cursorValue('group-1', 42);

    await onLocalDataReplaced();

    expect(mockClearQueue).toHaveBeenCalled();
    expect(mockEnqueueEntities).toHaveBeenCalledWith([
      { entityType: 'recipe', entityId: 'recipe-1' },
    ]);
    expect(mockPullSyncChanges).toHaveBeenCalledWith(0);
  });
});
