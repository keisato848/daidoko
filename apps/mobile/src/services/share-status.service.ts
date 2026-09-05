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

import {
  countSharedEntitiesByGroup,
  getCurrentSyncGroupId,
  getKnownSyncGroupSummaries,
  isEntityGroupsBackfillDone,
} from './entity-groups.service';
import { getRecipeBooks } from './recipe-book.service';
import { EMPTY_GROUP_COUNTS, visibleGroupCounts, type SyncGroupScope } from './share-groups';
import { getStoredCredentials } from './sync-client.service';
import { listWebShareRecipes, type WebShareRecipeListItem } from './web-share.service';
import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';

/**
 * グループ 1 つぶんの共有状態（G5/U3 — 実数と否定側）。
 * `shopping`/`pantry` の null は「このグループには**そもそも見えない**」
 * （scope='recipes'）。0 件（今は入っていない）と混ぜないこと。
 */
export interface GroupShareSection {
  groupId: string;
  /** グループ名（無名なら null — 表示側でフォールバック） */
  name: string | null;
  /** 主グループか（無名時のフォールバック名「家族グループ」の判定に使う） */
  isPrimary: boolean;
  /** 「いま見ているグループ」（G1/G2 — 新規データの既定所属先）か */
  isCurrent: boolean;
  scope: SyncGroupScope;
  /** メンバー数（0 = 不明 — 控えが古い・オフライン） */
  memberCount: number;
  recipes: number;
  books: number;
  shopping: number | null;
  pantry: number | null;
  /** 真なら「買い物リスト・在庫はこのグループには見えません」を必ず出す（G5） */
  showsRecipesOnlyNote: boolean;
}

export interface ShareStatus {
  /** 家族グループに参加しているか（ローカル判定） */
  familyJoined: boolean;
  /**
   * グループごとの共有状態（G-2b）。空配列 = グループ別表示が使えない
   * （未参加・所属バックフィル前）— UI は従来の 1 カード表示に倒す。
   * バックフィル前に出さないのは、所属が「まだ書かれていないだけ」なのに
   * 全部 0 件と表示すると実態（主グループへ全共有）と逆を言うことになるため
   */
  groups: GroupShareSection[];
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

/** グループ別の節を組み立てる。失敗したら空配列（従来表示に倒す） */
async function buildGroupSections(): Promise<GroupShareSection[]> {
  try {
    if (!(await isEntityGroupsBackfillDone())) return [];
    const [summaries, counts, currentGroupId] = await Promise.all([
      getKnownSyncGroupSummaries(),
      countSharedEntitiesByGroup(),
      getCurrentSyncGroupId(),
    ]);
    return summaries.map((summary, index) => {
      const visible = visibleGroupCounts(
        summary.scope,
        counts.get(summary.groupId) ?? EMPTY_GROUP_COUNTS,
      );
      return {
        groupId: summary.groupId,
        name: summary.name,
        isPrimary: index === 0,
        isCurrent: summary.groupId === currentGroupId,
        scope: summary.scope,
        memberCount: summary.memberCount,
        ...visible,
      };
    });
  } catch {
    return [];
  }
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
    groups: credentials !== null ? await buildGroupSections() : [],
    sharedRecipes,
    sharedBookCount: books.filter((book) => book.shareUrl != null).length,
    privateShoppingCount,
    privatePantryCount,
  };
}
