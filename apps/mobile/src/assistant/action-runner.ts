/**
 * actionRunner — カタログに登録された操作を確認付きで実行する。
 *
 * public API は `confirmMutate(id, args)` のみ。内部の `run` 関数は
 * モジュール外から import できない（export しない）。
 *
 * `confirmMutate` を呼ばない限り副作用（`addShoppingItem` 等）は起きない。
 */

import { addShoppingItem } from '../services/shopping-list.service';
import type { ShoppingItem } from '../services/types';
import { lookupCatalog } from './catalog';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ConfirmMutateResult =
  | { ok: true; item: ShoppingItem }
  | { ok: false; reason: 'duplicate' | 'unknown_action' };

// ---------------------------------------------------------------------------
// Internal runner — NOT exported
// ---------------------------------------------------------------------------

interface ShoppingAddArgs {
  name: string;
}

function isShoppingAddArgs(args: unknown): args is ShoppingAddArgs {
  return (
    typeof args === 'object' &&
    args !== null &&
    'name' in args &&
    typeof (args as ShoppingAddArgs).name === 'string'
  );
}

async function run(id: string, args: unknown): Promise<ConfirmMutateResult> {
  if (id === 'shopping.add') {
    if (!isShoppingAddArgs(args)) {
      // 不正な引数は unknown_action と同じ扱い（例外を投げない）
      return { ok: false, reason: 'unknown_action' };
    }
    const item = await addShoppingItem(args.name);
    if (item === null) {
      return { ok: false, reason: 'duplicate' };
    }
    return { ok: true, item };
  }

  // ここには到達しないはず（カタログチェック済み）が、念のため
  return { ok: false, reason: 'unknown_action' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * カタログに登録された mutate 操作を実行する。
 *
 * - カタログに無い `id` → `{ ok: false, reason: 'unknown_action' }`（例外を投げない）
 * - `shopping.add` で同名未チェック行あり → `{ ok: false, reason: 'duplicate' }`
 * - 成功 → `{ ok: true, item }`
 */
export async function confirmMutate(id: string, args: unknown): Promise<ConfirmMutateResult> {
  const entry = lookupCatalog(id);
  if (!entry) {
    return { ok: false, reason: 'unknown_action' };
  }
  return run(id, args);
}
