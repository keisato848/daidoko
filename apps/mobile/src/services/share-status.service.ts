/**
 * 「共有の管理」画面のデータ集約（S15 → share-status）。
 *
 * 共有の状態は 3 系統に散らばっている:
 *   1. 家族グループ（クラウド同期）— 参加状態は secure-store の鍵の有無
 *   2. リンク公開 — レシピ単体は app_meta、帖は recipe_books.share_url
 *   3. 品目ごとの「自分だけ」— shopping_items.shared / pantry_items.shared（0 = 自分だけ）
 * ここで 1 画面分にまとめ、「今なにが誰に共有されているか」を一望できるようにする。
 * ネットワークは叩かない（オフラインでも状態が見えることを優先。メンバー一覧は family 画面）。
 */
import { eq, sql } from 'drizzle-orm';

import { getRecipeBooks } from './recipe-book.service';
import { getStoredCredentials } from './sync-client.service';
import { listWebShareRecipes, type WebShareRecipeListItem } from './web-share.service';
import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';

export interface ShareStatus {
  /** 家族グループに参加しているか（ローカル判定） */
  familyJoined: boolean;
  /** リンクで公開中のレシピ単体（新しい順） */
  sharedRecipes: WebShareRecipeListItem[];
  /** 共有リンクを発行済みの帖の数（一覧は既存のレシピ帖管理画面が担う） */
  sharedBookCount: number;
  /** 「自分だけ」にしている買い物リストの品目数 */
  privateShoppingCount: number;
  /** 「自分だけ」にしている在庫の品目数 */
  privatePantryCount: number;
}

async function countPrivate(table: 'shopping' | 'pantry'): Promise<number> {
  if (!isNativePlatform) return 0;
  const target = table === 'shopping' ? schema.shoppingItems : schema.pantryItems;
  const rows = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(target)
    .where(eq(target.shared, 0));
  return rows[0]?.count ?? 0;
}

export async function getShareStatus(): Promise<ShareStatus> {
  const [credentials, sharedRecipes, books, privateShoppingCount, privatePantryCount] =
    await Promise.all([
      getStoredCredentials().catch(() => null),
      listWebShareRecipes().catch(() => []),
      getRecipeBooks().catch(() => []),
      countPrivate('shopping').catch(() => 0),
      countPrivate('pantry').catch(() => 0),
    ]);
  return {
    familyJoined: credentials !== null,
    sharedRecipes,
    sharedBookCount: books.filter((book) => book.shareUrl != null).length,
    privateShoppingCount,
    privatePantryCount,
  };
}
