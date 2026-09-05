/**
 * 多グループ共有の表示判断（G-2b）。固定したいこと:
 *
 * - 参加グループ控えの読み解き: **旧形式（G-2a の id 配列）も読める**・主グループが先頭・
 *   壊れた控えでも主グループのスタブで成立する（G7: 単一グループの表示が壊れない）
 * - 共有の管理（G5/U3）: scope='recipes' のグループでは買い物・在庫が **null**（=そもそも
 *   見えない）になり、0 件（今は入っていない）と区別できる
 * - レシピ詳細のバッジ（U4）: バックフィル前に「自分だけ」と誤表示しない・
 *   未参加ではグループ系バッジを出さない・リンク公開は独立に併存する
 */
import {
  EMPTY_GROUP_COUNTS,
  buildRecipeShareBadges,
  parseKnownGroupSummaries,
  sortPrimaryFirst,
  visibleGroupCounts,
  type KnownGroupSummary,
} from '../share-groups';

const PRIMARY = 'g-main';

function summary(overrides: Partial<KnownGroupSummary> = {}): KnownGroupSummary {
  return {
    groupId: 'g-x',
    name: null,
    scope: 'all',
    isOwner: false,
    memberCount: 0,
    ...overrides,
  };
}

describe('parseKnownGroupSummaries — 控えの読み解き', () => {
  it('控えが無ければ主グループのスタブ 1 件（単一グループの現行表示）', () => {
    expect(parseKnownGroupSummaries(null, PRIMARY)).toEqual([
      { groupId: PRIMARY, name: null, scope: 'all', isOwner: false, memberCount: 0 },
    ]);
  });

  it('壊れた JSON・配列でない JSON でも投げずにスタブへ倒す', () => {
    expect(parseKnownGroupSummaries('{ not json', PRIMARY)[0]?.groupId).toBe(PRIMARY);
    expect(parseKnownGroupSummaries('{"a":1}', PRIMARY)).toHaveLength(1);
  });

  it('**旧形式（G-2a: 文字列 id の配列）も読める** — scope は all・無名として扱う', () => {
    const parsed = parseKnownGroupSummaries(JSON.stringify([PRIMARY, 'g-sub']), PRIMARY);
    expect(parsed.map((group) => group.groupId)).toEqual([PRIMARY, 'g-sub']);
    expect(parsed[1]).toMatchObject({ scope: 'all', name: null });
  });

  it('新形式（詳細つき）は名前・scope・メンバー数を保つ', () => {
    const raw = JSON.stringify([
      { groupId: PRIMARY, name: null, scope: 'all', isOwner: true, memberCount: 3 },
      { groupId: 'g-sub', name: '娘と', scope: 'recipes', isOwner: true, memberCount: 2 },
    ]);
    expect(parseKnownGroupSummaries(raw, PRIMARY)[1]).toEqual({
      groupId: 'g-sub',
      name: '娘と',
      scope: 'recipes',
      isOwner: true,
      memberCount: 2,
    });
  });

  it('主グループが控えに無くても先頭にスタブとして足す', () => {
    const parsed = parseKnownGroupSummaries(JSON.stringify(['g-sub']), PRIMARY);
    expect(parsed.map((group) => group.groupId)).toEqual([PRIMARY, 'g-sub']);
  });

  it('主グループが後ろにあっても先頭へ寄せる。重複 id は 1 件にする', () => {
    const parsed = parseKnownGroupSummaries(JSON.stringify(['g-sub', PRIMARY, 'g-sub']), PRIMARY);
    expect(parsed.map((group) => group.groupId)).toEqual([PRIMARY, 'g-sub']);
  });

  it('壊れた scope・空 id は捨てるか all に倒す', () => {
    const raw = JSON.stringify([{ groupId: 'g-a', scope: 'everything' }, { groupId: '' }, 42]);
    const parsed = parseKnownGroupSummaries(raw, PRIMARY);
    expect(parsed.map((group) => group.groupId)).toEqual([PRIMARY, 'g-a']);
    expect(parsed[1]?.scope).toBe('all');
  });
});

describe('sortPrimaryFirst', () => {
  it('主グループを先頭に、他は元の並びのまま', () => {
    const sorted = sortPrimaryFirst(
      [summary({ groupId: 'g-b' }), summary({ groupId: PRIMARY }), summary({ groupId: 'g-a' })],
      PRIMARY,
    );
    expect(sorted.map((group) => group.groupId)).toEqual([PRIMARY, 'g-b', 'g-a']);
  });
});

describe('visibleGroupCounts — G5 の否定側', () => {
  it("scope='all' は 4 種の実数を全部見せる", () => {
    expect(visibleGroupCounts('all', { recipes: 3, books: 1, shopping: 2, pantry: 5 })).toEqual({
      recipes: 3,
      books: 1,
      shopping: 2,
      pantry: 5,
      showsRecipesOnlyNote: false,
    });
  });

  it("scope='recipes' は買い物・在庫が null（0 件ではなく『そもそも見えない』）", () => {
    const visible = visibleGroupCounts('recipes', { recipes: 3, books: 1, shopping: 2, pantry: 5 });
    expect(visible.shopping).toBeNull();
    expect(visible.pantry).toBeNull();
    expect(visible.showsRecipesOnlyNote).toBe(true);
  });

  it('空カウントでも形は同じ', () => {
    expect(visibleGroupCounts('all', EMPTY_GROUP_COUNTS).recipes).toBe(0);
  });
});

describe('buildRecipeShareBadges — U4', () => {
  it('未参加ではグループ系バッジを出さない（リンク公開だけは出す）', () => {
    expect(
      buildRecipeShareBadges({
        joined: false,
        backfilled: false,
        groupNames: [],
        primaryGroupName: '',
        webShareActive: false,
      }),
    ).toEqual([]);
    expect(
      buildRecipeShareBadges({
        joined: false,
        backfilled: false,
        groupNames: [],
        primaryGroupName: '',
        webShareActive: true,
      }),
    ).toEqual([{ kind: 'link' }]);
  });

  it('**バックフィル前は「自分だけ」と誤表示しない** — 主グループ名で共有中を出す', () => {
    expect(
      buildRecipeShareBadges({
        joined: true,
        backfilled: false,
        groupNames: [],
        primaryGroupName: '家族グループ',
        webShareActive: false,
      }),
    ).toEqual([{ kind: 'groups', names: ['家族グループ'] }]);
  });

  it('所属グループがあればグループ名バッジ、無ければ自分だけ', () => {
    expect(
      buildRecipeShareBadges({
        joined: true,
        backfilled: true,
        groupNames: ['家族グループ', '娘と'],
        primaryGroupName: '家族グループ',
        webShareActive: false,
      }),
    ).toEqual([{ kind: 'groups', names: ['家族グループ', '娘と'] }]);
    expect(
      buildRecipeShareBadges({
        joined: true,
        backfilled: true,
        groupNames: [],
        primaryGroupName: '家族グループ',
        webShareActive: false,
      }),
    ).toEqual([{ kind: 'private' }]);
  });

  it('リンク公開はグループ共有と併存する（両方出る）', () => {
    expect(
      buildRecipeShareBadges({
        joined: true,
        backfilled: true,
        groupNames: ['家族グループ'],
        primaryGroupName: '家族グループ',
        webShareActive: true,
      }),
    ).toEqual([{ kind: 'groups', names: ['家族グループ'] }, { kind: 'link' }]);
  });
});
