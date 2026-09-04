/**
 * 多グループ共有の表示判断（G-2b — `docs/共有設計.md` §5-4 / `docs/クラウド同期設計.md` §12-5）。
 *
 * ここは **I/O を持たない純関数だけ**。DB（entity_groups の集計）は
 * `entity-groups.service.ts`、サーバー通信は `sync-client.service.ts` が担当する
 * （DB を掴む経路は jest で叩けない — `docs/品質基準.md` §2.3 の分割方針）。
 *
 * 扱う判断:
 * - 参加グループ一覧のローカル控え（app_meta の JSON）の読み解きと並び
 * - グループの範囲（scope）ごとに「何の件数を見せ、何を『見えない』と明示するか」（G5）
 * - レシピ詳細の共有状態バッジ（U4）の導出
 */

import { type SyncGroupScope } from './sync-payload';

export { type SyncGroupScope };

/** 参加グループ 1 件の要約（サーバー応答とローカル控えで共通の形） */
export interface KnownGroupSummary {
  groupId: string;
  /** グループの表示名（無名なら null）。既存の家族グループは無名のことがある */
  name: string | null;
  scope: SyncGroupScope;
  isOwner: boolean;
  memberCount: number;
}

function isScope(value: unknown): value is SyncGroupScope {
  return value === 'all' || value === 'recipes';
}

/**
 * 参加グループのローカル控え（app_meta `sync_known_groups` の JSON）を読み解く。
 *
 * - **旧形式（G-2a: 文字列 id の配列）も読める。** G-2b でこの鍵は
 *   `{groupId, name, scope, …}` の配列へ拡張された（scope を控えないと、
 *   レシピ限定グループへ買い物・在庫の既定所属を付けてしまう）。旧形式の id は
 *   scope 'all'・無名として扱う（既存グループはすべて全部入り — §12-4 G7）
 * - **主グループが必ず先頭**（`getKnownSyncGroupIds` と同じ約束）
 * - 控えが無い・壊れている・主グループが含まれていないときは、主グループの
 *   スタブ（無名・scope 'all'・メンバー数 0 = 不明）だけを返す ＝ 現行の単一グループ表示
 */
export function parseKnownGroupSummaries(
  raw: string | null,
  primaryGroupId: string,
): KnownGroupSummary[] {
  const primaryStub: KnownGroupSummary = {
    groupId: primaryGroupId,
    name: null,
    scope: 'all',
    isOwner: false,
    memberCount: 0,
  };
  if (!raw) return [primaryStub];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [primaryStub];
  }
  if (!Array.isArray(parsed)) return [primaryStub];
  const groups: KnownGroupSummary[] = [];
  const push = (group: KnownGroupSummary) => {
    if (groups.some((existing) => existing.groupId === group.groupId)) return;
    groups.push(group);
  };
  for (const entry of parsed) {
    if (typeof entry === 'string') {
      // 旧形式（G-2a）: id だけ。scope 'all'・無名として読む
      if (entry !== '') push({ ...primaryStub, groupId: entry });
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as Partial<KnownGroupSummary>;
    if (typeof candidate.groupId !== 'string' || candidate.groupId === '') continue;
    push({
      groupId: candidate.groupId,
      name: typeof candidate.name === 'string' && candidate.name !== '' ? candidate.name : null,
      scope: isScope(candidate.scope) ? candidate.scope : 'all',
      isOwner: candidate.isOwner === true,
      memberCount: typeof candidate.memberCount === 'number' ? candidate.memberCount : 0,
    });
  }
  return sortPrimaryFirst(groups, primaryGroupId, primaryStub);
}

/** 主グループを先頭へ（無ければスタブを足す）。以降は元の並びを保つ */
export function sortPrimaryFirst(
  groups: readonly KnownGroupSummary[],
  primaryGroupId: string,
  primaryStub?: KnownGroupSummary,
): KnownGroupSummary[] {
  const primary = groups.find((group) => group.groupId === primaryGroupId);
  const others = groups.filter((group) => group.groupId !== primaryGroupId);
  if (primary) return [primary, ...others];
  const stub = primaryStub ?? {
    groupId: primaryGroupId,
    name: null,
    scope: 'all' as const,
    isOwner: false,
    memberCount: 0,
  };
  return [stub, ...others];
}

// ── 共有の管理（G5/U3: 実数と否定側） ───────────────────────────────────────

/** グループに入っている実体の実数（entity_groups × 生きている行の交わり） */
export interface GroupShareCounts {
  recipes: number;
  books: number;
  shopping: number;
  pantry: number;
}

export const EMPTY_GROUP_COUNTS: GroupShareCounts = {
  recipes: 0,
  books: 0,
  shopping: 0,
  pantry: 0,
};

/**
 * scope に応じて「見せる件数」と「見えないと明示する種別」を決める（G5）。
 *
 * - `shopping`/`pantry` が null ＝ **このグループには構造的に見えない**（scope='recipes'）。
 *   0 件との区別が肝 — 「0 件」は『今は入っていない』、「null」は『そもそも流れない』。
 *   隆の懸念（買い物リスト＝家計が見えるのでは）には 0 件表示では答えにならない
 * - `showsRecipesOnlyNote` が真のとき、UI は否定文
 *   「買い物リスト・在庫はこのグループには見えません」を必ず出す
 */
export function visibleGroupCounts(
  scope: SyncGroupScope,
  counts: GroupShareCounts,
): {
  recipes: number;
  books: number;
  shopping: number | null;
  pantry: number | null;
  showsRecipesOnlyNote: boolean;
} {
  if (scope === 'recipes') {
    return {
      recipes: counts.recipes,
      books: counts.books,
      shopping: null,
      pantry: null,
      showsRecipesOnlyNote: true,
    };
  }
  return {
    recipes: counts.recipes,
    books: counts.books,
    shopping: counts.shopping,
    pantry: counts.pantry,
    showsRecipesOnlyNote: false,
  };
}

// ── レシピ詳細の状態バッジ（U4） ────────────────────────────────────────────

export type RecipeShareBadge =
  /** どこかのグループに入っている。`names` は入っているグループの表示名（表示順） */
  | { kind: 'groups'; names: string[] }
  /** グループに参加しているのに、このレシピはどのグループにも入っていない（G9） */
  | { kind: 'private' }
  /** リンクで公開中（Web 共有） */
  | { kind: 'link' };

/**
 * レシピ詳細に出す共有状態バッジ（U4）。
 *
 * - 未参加なら**グループ系バッジは出さない**（共有そのものが無い状態に
 *   「自分だけ」と出しても意味が無く、全レシピに付いてノイズになる）。
 *   リンク公開だけは未参加でも起こるので出す
 * - **バックフィル（§12-4）前は所属ゼロを「自分だけ」と読まない。**
 *   所属はまだ書かれていないだけで、実態は主グループへ全部共有されている —
 *   G-2a の push 側の安全弁（fanoutReady）と同じ理由。主グループ名で「共有中」を出す
 * - リンク公開はグループ共有と独立に併存する（両方出ることがある）
 */
export function buildRecipeShareBadges(input: {
  joined: boolean;
  backfilled: boolean;
  /** このレシピが入っているグループの表示名（参加中のものだけ） */
  groupNames: readonly string[];
  /** 主グループの表示名（バックフィル前のフォールバック用） */
  primaryGroupName: string;
  webShareActive: boolean;
}): RecipeShareBadge[] {
  const badges: RecipeShareBadge[] = [];
  if (input.joined) {
    if (!input.backfilled) {
      badges.push({ kind: 'groups', names: [input.primaryGroupName] });
    } else if (input.groupNames.length > 0) {
      badges.push({ kind: 'groups', names: [...input.groupNames] });
    } else {
      badges.push({ kind: 'private' });
    }
  }
  if (input.webShareActive) badges.push({ kind: 'link' });
  return badges;
}
