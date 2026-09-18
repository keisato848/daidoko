/**
 * action-runner のテスト。
 *
 * - confirmMutate('shopping.add', { name }) → addShoppingItem が呼ばれる
 * - addShoppingItem が null を返す → { ok: false, reason: 'duplicate' }
 * - カタログに無い id → { ok: false, reason: 'unknown_action' }
 * - confirmMutate を呼ばない限り addShoppingItem は呼ばれない
 * - destructive は型に書けない（@ts-expect-error で固定）
 */

import type { ShoppingItem } from '../../services/types';

// ---------------------------------------------------------------------------
// shopping-list.service のモック
// ---------------------------------------------------------------------------
const mockAddShoppingItem = jest.fn<Promise<ShoppingItem | null>, [string]>();

jest.mock('../../services/shopping-list.service', () => ({
  addShoppingItem: (...args: unknown[]) => mockAddShoppingItem(args[0] as string),
}));

// テスト対象を import（モックの後に）
import { confirmMutate } from '../action-runner';
import type { CatalogEntry, CatalogTier } from '../catalog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeItem(name: string): ShoppingItem {
  return {
    id: 'test-id',
    name,
    amount: null,
    checked: false,
    source: 'manual',
    recipeId: null,
    storeGroup: null,
    createdBy: null,
    checkedBy: null,
    shared: true,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('confirmMutate', () => {
  beforeEach(() => {
    mockAddShoppingItem.mockReset();
  });

  it('shopping.add — 成功すると { ok: true, item } を返す', async () => {
    const item = fakeItem('玉ねぎ');
    mockAddShoppingItem.mockResolvedValue(item);

    const result = await confirmMutate('shopping.add', { name: '玉ねぎ' });

    expect(mockAddShoppingItem).toHaveBeenCalledWith('玉ねぎ');
    expect(result).toEqual({ ok: true, item });
  });

  it('shopping.add — 重複（null）なら { ok: false, reason: "duplicate" }', async () => {
    mockAddShoppingItem.mockResolvedValue(null);

    const result = await confirmMutate('shopping.add', { name: '玉ねぎ' });

    expect(result).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('カタログに無い id は unknown_action を返す（例外を投げない）', async () => {
    const result = await confirmMutate('nonexistent.action', { foo: 1 });

    expect(result).toEqual({ ok: false, reason: 'unknown_action' });
    expect(mockAddShoppingItem).not.toHaveBeenCalled();
  });

  it('confirmMutate を呼ばない限り addShoppingItem は呼ばれない', () => {
    // モジュール読み込みだけでは副作用なし
    expect(mockAddShoppingItem).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 型レベルテスト: destructive は CatalogEntry に書けない
  // -----------------------------------------------------------------------
  it('CatalogTier に destructive は含まれない（型で塞ぐ）', () => {
    // @ts-expect-error - 'destructive' は CatalogTier に存在しない
    const _invalidTier: CatalogTier = 'destructive';

    // @ts-expect-error - destructive な tier は CatalogEntry に書けない
    const _invalidEntry: CatalogEntry = { id: 'x', tier: 'destructive' };

    // ランタイムには到達するが、型チェック時にエラーになることが目的
    expect(_invalidTier).toBe('destructive');
    expect(_invalidEntry.tier).toBe('destructive');
  });
});
