/**
 * AI 推論の月次無料枠（`lib/quota-store.ts`）。docs/買い物リスト・在庫設計.md §10.10.1。
 *
 * ここで守りたいのは 3 つ。
 * 1. 端末・カテゴリごとに独立して数える（他の端末・他の用途を巻き込まない）。
 * 2. 月替わりで 0 に戻る（UTC の 'YYYY-MM'）。
 * 3. `limit` が 0 以下なら枠管理そのものを無効化する（rate-limit.ts の流儀と同じ）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env['INFER_QUOTA_DB_PATH'] = ':memory:';

import {
  peekMonthlyQuota,
  recordMonthlyUse,
  resetQuotaStoreForTesting,
} from '../lib/quota-store.js';

beforeEach(() => {
  resetQuotaStoreForTesting();
  vi.useRealTimers();
});

describe('quota-store', () => {
  it('recordMonthlyUse で数え、limit に達したら peekMonthlyQuota が false になる', () => {
    expect(peekMonthlyQuota('d1', 'infer', 2)).toBe(true);
    recordMonthlyUse('d1', 'infer');
    expect(peekMonthlyQuota('d1', 'infer', 2)).toBe(true);
    recordMonthlyUse('d1', 'infer');
    expect(peekMonthlyQuota('d1', 'infer', 2)).toBe(false);
  });

  it('category ごとに独立して数える', () => {
    recordMonthlyUse('d1', 'infer');
    expect(peekMonthlyQuota('d1', 'infer', 1)).toBe(false);
    // 別カテゴリは無傷
    expect(peekMonthlyQuota('d1', 'other', 1)).toBe(true);
  });

  it('端末ごとに独立して数える', () => {
    recordMonthlyUse('d1', 'infer');
    expect(peekMonthlyQuota('d1', 'infer', 1)).toBe(false);
    expect(peekMonthlyQuota('d2', 'infer', 1)).toBe(true);
  });

  it('limit が 0 以下なら枠管理を無効化する（常に true）', () => {
    recordMonthlyUse('d1', 'infer');
    recordMonthlyUse('d1', 'infer');
    expect(peekMonthlyQuota('d1', 'infer', 0)).toBe(true);
    expect(peekMonthlyQuota('d1', 'infer', -1)).toBe(true);
  });

  it('月替わりで 0 に戻る（UTC の年月）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-31T23:00:00Z'));
    recordMonthlyUse('d1', 'infer');
    expect(peekMonthlyQuota('d1', 'infer', 1)).toBe(false);

    vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
    expect(peekMonthlyQuota('d1', 'infer', 1)).toBe(true);
  });
});
