/**
 * 同期の送信待ちキュー（S1 — docs/クラウド同期設計.md §5-1b）。
 *
 * 固定したいこと:
 * - **受信適用中は積まない**（受け取った変更を押し返す往復を作らない）
 * - 積む処理は**絶対に例外を投げない**（レシピ保存を同期の都合で失敗させない）
 * - 送信できた分を消すときは `queuedAt` も一致させる
 *   （送信中に入った編集を消してしまわない）
 */
const mockDb = {
  insert: jest.fn(),
  select: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
};

jest.mock('../../db/client', () => ({
  isNativePlatform: true,
  getDb: () => mockDb,
}));

import {
  clearSyncQueue,
  enqueueSyncEntity,
  isApplyingRemoteChanges,
  listSyncQueue,
  removeSentSyncQueueEntries,
  setSyncQueueListener,
  withRemoteApply,
} from '../sync-queue.service';

interface RecordedInsert {
  values: Record<string, unknown>;
  conflict: unknown;
}

let inserts: RecordedInsert[] = [];
let deletes: unknown[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  inserts = [];
  deletes = [];
  setSyncQueueListener(null);

  mockDb.insert.mockImplementation(() => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoUpdate: async (conflict: unknown) => {
        inserts.push({ values, conflict });
      },
    }),
  }));
  mockDb.select.mockImplementation(() => ({
    from: () => ({ orderBy: () => ({ limit: async () => [] }) }),
  }));
  mockDb.delete.mockImplementation(() => ({
    where: async (condition: unknown) => {
      deletes.push(condition);
    },
    then: (resolve: (value: unknown) => void) => resolve(undefined),
  }));
});

describe('enqueueSyncEntity', () => {
  it('積んだら送信のきっかけを知らせる', async () => {
    const listener = jest.fn();
    setSyncQueueListener(listener);

    await enqueueSyncEntity('recipe', 'recipe-1');

    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({ entityType: 'recipe', entityId: 'recipe-1' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('受信適用中は積まない（押し返しの往復を作らない）', async () => {
    const listener = jest.fn();
    setSyncQueueListener(listener);

    await withRemoteApply(async () => {
      await enqueueSyncEntity('recipe', 'recipe-1');
    });

    expect(inserts).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('適用が終われば また積める', async () => {
    await withRemoteApply(async () => undefined);
    await enqueueSyncEntity('recipe', 'recipe-1');

    expect(inserts).toHaveLength(1);
  });

  it('適用中に例外が出ても抑止は必ず戻る', async () => {
    await expect(
      withRemoteApply(async () => {
        throw new Error('apply failed');
      }),
    ).rejects.toThrow('apply failed');

    expect(isApplyingRemoteChanges()).toBe(false);
    await enqueueSyncEntity('recipe', 'recipe-1');
    expect(inserts).toHaveLength(1);
  });

  it('入れ子でも正しく戻る', async () => {
    await withRemoteApply(async () => {
      await withRemoteApply(async () => {
        expect(isApplyingRemoteChanges()).toBe(true);
      });
      // 内側が終わっても外側はまだ適用中
      expect(isApplyingRemoteChanges()).toBe(true);
    });

    expect(isApplyingRemoteChanges()).toBe(false);
  });

  it('DB が失敗しても投げない（レシピ保存を巻き添えにしない）', async () => {
    mockDb.insert.mockImplementation(() => {
      throw new Error('database is locked');
    });

    await expect(enqueueSyncEntity('recipe', 'recipe-1')).resolves.toBeUndefined();
  });

  it('ID が空なら何もしない', async () => {
    await enqueueSyncEntity('recipe', '');

    expect(inserts).toHaveLength(0);
  });
});

describe('listSyncQueue', () => {
  it('DB が失敗しても空配列（同期が止まらない）', async () => {
    mockDb.select.mockImplementation(() => {
      throw new Error('no such table: sync_queue');
    });

    expect(await listSyncQueue()).toEqual([]);
  });
});

describe('removeSentSyncQueueEntries', () => {
  it('送った行の数だけ削除する', async () => {
    await removeSentSyncQueueEntries([
      { entityType: 'recipe', entityId: 'r1', queuedAt: 'now', retryCount: 0 },
      { entityType: 'recipe_book', entityId: 'b1', queuedAt: 'now', retryCount: 0 },
    ]);

    expect(deletes).toHaveLength(2);
  });

  it('空なら DB を触らない', async () => {
    await removeSentSyncQueueEntries([]);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});

describe('clearSyncQueue', () => {
  it('DB が失敗しても投げない', async () => {
    mockDb.delete.mockImplementation(() => {
      throw new Error('database is locked');
    });

    await expect(clearSyncQueue()).resolves.toBeUndefined();
  });
});
