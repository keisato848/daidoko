/**
 * 同期の実行役（S1 — docs/クラウド同期設計.md §5-1b）。
 *
 * 固定したいこと:
 * - 未参加なら何もしない（サーバーを叩かない）
 * - 送れた分だけ待ち行列から消す。失敗した分は残す（＝取りこぼさない）
 * - **自端末が押した変更は適用しない**（押し返しの往復を作らない）
 * - カーソルは進み、別グループのカーソルは引き継がない
 * - 1 件がサーバーに弾かれても、残りが永久に詰まらない
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
import {
  onLocalDataReplaced,
  onSyncGroupJoined,
  onSyncGroupLeft,
  resetSyncRunnerForTesting,
  runSync,
} from '../sync-runner.service';
import { useSyncStore } from '../../stores/sync.store';

const CREDENTIALS = { groupId: 'group-1', deviceId: 'device-me', deviceSecret: 'secret' };

function queueEntry(entityId: string, entityType = 'recipe') {
  return { entityType, entityId, queuedAt: '2026-08-21T10:00:00.000Z', retryCount: 0 };
}

function outgoing(entityId: string, entityType = 'recipe') {
  return {
    entityType,
    entityId,
    payload: JSON.stringify({ schemaVersion: 1, entity: entityType, id: entityId }),
    clientUpdatedAt: '2026-08-21T10:00:00.000Z',
    deleted: false,
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

beforeEach(() => {
  jest.clearAllMocks();
  mockMeta = {};
  resetSyncRunnerForTesting();
  useSyncStore.getState().resetForTesting();
  mockGetStoredCredentials.mockResolvedValue(CREDENTIALS);
  mockListSyncQueue.mockResolvedValue([]);
  mockPullSyncChanges.mockResolvedValue(emptyPull());
  mockPushSyncChanges.mockResolvedValue({ applied: 0, latestSeq: 0 });
  mockApplyIncomingChange.mockResolvedValue(true);
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
    mockListSyncQueue.mockResolvedValue([
      queueEntry('recipe-1'),
      queueEntry('book-1', 'recipe_book'),
    ]);
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

  it('組み立てられない行は送らずに捨てる（詰まらせない）', async () => {
    mockListSyncQueue.mockResolvedValue([queueEntry('gone', 'unknown_kind')]);
    mockBuildOutgoingChange.mockResolvedValue(null);

    await runSync();

    expect(mockPushSyncChanges).not.toHaveBeenCalled();
    expect(mockRemoveSent).toHaveBeenCalledWith([expect.objectContaining({ entityId: 'gone' })]);
  });

  it('大きすぎる 1 件は送らない（バッチ全体を巻き添えにしない）', async () => {
    mockListSyncQueue.mockResolvedValue([queueEntry('huge'), queueEntry('recipe-1')]);
    mockBuildOutgoingChange
      .mockResolvedValueOnce({ ...outgoing('huge'), payload: 'x'.repeat(300_000) })
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

  it('サーバーに弾かれたら 1 件ずつ送り直し、通らない 1 件だけ捨てる', async () => {
    mockListSyncQueue.mockResolvedValue([queueEntry('poison'), queueEntry('good')]);
    mockBuildOutgoingChange
      .mockResolvedValueOnce(outgoing('poison'))
      .mockResolvedValueOnce(outgoing('good'));
    mockPushSyncChanges
      .mockRejectedValueOnce(new SyncError('SERVER')) // バッチ
      .mockRejectedValueOnce(new SyncError('SERVER')) // poison 単体
      .mockResolvedValueOnce({ applied: 1, latestSeq: 1 }); // good 単体

    await runSync();

    expect(mockPushSyncChanges).toHaveBeenCalledTimes(3);
    const removed = mockRemoveSent.mock.calls.flatMap((call) => call[0]);
    expect(removed.map((entry: { entityId: string }) => entry.entityId)).toEqual([
      'poison',
      'good',
    ]);
  });
});

describe('runSync — pull', () => {
  it('自端末が押した変更は適用しない', async () => {
    mockPullSyncChanges.mockResolvedValue({
      changes: [incoming('recipe-1', 1, 'device-me'), incoming('recipe-2', 2, 'device-other')],
      deltas: [],
      latestSeq: 2,
      hasMore: false,
    });

    await runSync();

    expect(mockApplyIncomingChange).toHaveBeenCalledTimes(1);
    expect(mockApplyIncomingChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'recipe-2' }),
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
    expect(JSON.parse(mockMeta['sync_cursor'])).toEqual({ groupId: 'group-1', seq: 7 });
  });

  it('保存済みカーソルの続きから取る', async () => {
    mockMeta['sync_cursor'] = JSON.stringify({ groupId: 'group-1', seq: 12 });

    await runSync();

    expect(mockPullSyncChanges).toHaveBeenCalledWith(12);
  });

  it('別グループのカーソルは使わない（他人のバックアップ復元対策）', async () => {
    mockMeta['sync_cursor'] = JSON.stringify({ groupId: 'group-other', seq: 99 });

    await runSync();

    expect(mockPullSyncChanges).toHaveBeenCalledWith(0);
  });

  it('hasMore なら続きを取りに行く', async () => {
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

    expect(mockPullSyncChanges).toHaveBeenNthCalledWith(1, 0);
    expect(mockPullSyncChanges).toHaveBeenNthCalledWith(2, 5);
    expect(JSON.parse(mockMeta['sync_cursor'])).toEqual({ groupId: 'group-1', seq: 9 });
  });

  it('適用が 1 件でもあれば画面に読み直しの合図を出す', async () => {
    mockPullSyncChanges.mockResolvedValue({
      changes: [incoming('recipe-2', 1, 'device-other')],
      deltas: [],
      latestSeq: 1,
      hasMore: false,
    });

    await runSync();

    expect(useSyncStore.getState().lastAppliedAt).toBeGreaterThan(0);
  });

  it('自端末由来だけなら合図は出さない（画面のちらつきを作らない）', async () => {
    mockPullSyncChanges.mockResolvedValue({
      changes: [incoming('recipe-1', 1, 'device-me')],
      deltas: [],
      latestSeq: 1,
      hasMore: false,
    });

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
  it('取れたら登録し、同じトークンなら二度目は登録しない', async () => {
    mockGetExpoPushToken.mockResolvedValue('ExponentPushToken[abc]');

    await runSync();
    await runSync();

    expect(mockRegisterSyncPushToken).toHaveBeenCalledTimes(1);
    expect(mockRegisterSyncPushToken).toHaveBeenCalledWith('ExponentPushToken[abc]');
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
    mockMeta['sync_cursor'] = JSON.stringify({ groupId: 'group-old', seq: 42 });

    await onSyncGroupJoined();

    expect(mockEnqueueEntities).toHaveBeenCalledWith([
      { entityType: 'recipe', entityId: 'recipe-1' },
      { entityType: 'recipe_book', entityId: 'book-1' },
    ]);
    expect(mockPullSyncChanges).toHaveBeenCalledWith(0);
  });

  it('離脱したら送信待ちとカーソルを捨てる', async () => {
    mockMeta['sync_cursor'] = JSON.stringify({ groupId: 'group-1', seq: 42 });

    await onSyncGroupLeft();

    expect(mockClearQueue).toHaveBeenCalled();
    expect(mockMeta['sync_cursor']).toBe('');
  });

  it('バックアップ復元後は取り直し（カーソル 0）＋全件積み直し', async () => {
    mockListAllSyncableEntities.mockResolvedValue([{ entityType: 'recipe', entityId: 'recipe-1' }]);
    mockMeta['sync_cursor'] = JSON.stringify({ groupId: 'group-1', seq: 42 });

    await onLocalDataReplaced();

    expect(mockClearQueue).toHaveBeenCalled();
    expect(mockEnqueueEntities).toHaveBeenCalledWith([
      { entityType: 'recipe', entityId: 'recipe-1' },
    ]);
    expect(mockPullSyncChanges).toHaveBeenCalledWith(0);
  });
});
