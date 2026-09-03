/**
 * 同期ペイロードの純関数（S1 — docs/クラウド同期設計.md §5-1b）。
 *
 * 固定したいこと:
 * - **写真パスが payload に混ざらない**（写真は S3。混ざると受信側の写真を消す）
 * - 壊れた・新しすぎる payload は例外ではなく null（1 件捨てて同期は続く）
 * - LWW は updatedAt 基準・同値は受信側（サーバー）優先
 */
import {
  SYNC_ENTITY_NAME_ALIAS,
  SYNC_ENTITY_PANTRY_ITEM,
  SYNC_ENTITY_RECIPE,
  SYNC_ENTITY_RECIPE_BOOK,
  SYNC_ENTITY_SHOPPING_ITEM,
  SYNC_PAYLOAD_SCHEMA_VERSION,
  entityGroupKeyOf,
  entityGroupMapKey,
  hasNaturalKey,
  incomingChangeWins,
  isSyncEntityType,
  parseSyncPayload,
  planPushFanout,
  resolveCurrentGroupId,
  serializeSyncPayload,
  shouldAssignDefaultGroup,
  syncCursorStorageKey,
  type RecipeBookSyncPayload,
  type RecipeSyncPayload,
} from '../sync-payload';

function recipePayload(overrides: Partial<RecipeSyncPayload> = {}): RecipeSyncPayload {
  return {
    schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
    entity: SYNC_ENTITY_RECIPE,
    recipe: {
      id: 'recipe-1',
      title: '肉じゃが',
      titleReading: 'にくじゃが',
      status: 'active',
      placeName: null,
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
    },
    revision: {
      id: 'rev-1',
      revisionNumber: 2,
      isMajor: true,
      servings: 4,
      cookTimeMin: 30,
      prepTimeMin: null,
      description: 'ほくほく',
      authorNote: null,
      createdAt: '2026-08-21T10:00:00.000Z',
    },
    source: {
      id: 'source-1',
      type: 'url',
      url: 'https://example.com/recipe',
      siteName: 'example',
      pageTitle: '肉じゃが',
      capturedAt: null,
      createdAt: '2026-08-20T10:00:00.000Z',
    },
    ingredients: [
      {
        id: 'ing-1',
        sortOrder: 1,
        groupLabel: null,
        name: 'じゃがいも',
        amount: '3個',
        note: null,
      },
    ],
    steps: [{ id: 'step-1', sortOrder: 1, body: '切る', timerSec: null }],
    tags: ['和食'],
    ...overrides,
  };
}

function bookPayload(overrides: Partial<RecipeBookSyncPayload> = {}): RecipeBookSyncPayload {
  return {
    schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
    entity: SYNC_ENTITY_RECIPE_BOOK,
    book: {
      id: 'book-1',
      title: '週末の定番',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
    },
    recipeIds: ['recipe-1', 'recipe-2'],
    ...overrides,
  };
}

describe('sync-payload — レシピ', () => {
  it('往復しても中身が変わらない', () => {
    const payload = recipePayload();
    const parsed = parseSyncPayload(SYNC_ENTITY_RECIPE, serializeSyncPayload(payload));
    expect(parsed).toEqual(payload);
  });

  it('写真の列を持たない（S1 はテキストだけ）', () => {
    const json = serializeSyncPayload(recipePayload());
    expect(json).not.toContain('coverPhotoPath');
    expect(json).not.toContain('photoPath');
    expect(json).not.toContain('photoId');
    // 所属・作成者も運ばない（受信側のローカル値を使う）
    expect(json).not.toContain('familyId');
    expect(json).not.toContain('createdBy');
    // 作りたいリストのピンも運ばない（人ごとの都合・LWW の時計を汚さないため）
    expect(json).not.toContain('pinnedAt');
  });

  it('出所（URL 取り込みの印）は運ぶ — 受信側の共有ゲートが素通りしないため', () => {
    const parsed = parseSyncPayload(SYNC_ENTITY_RECIPE, serializeSyncPayload(recipePayload()));
    expect(parsed && 'source' in parsed ? parsed.source?.type : null).toBe('url');
    // ただし OCR の生テキストは型に無い
    expect(serializeSyncPayload(recipePayload())).not.toContain('ocrRawText');
  });

  it('リビジョンが無いレシピも運べる', () => {
    const payload = recipePayload({ revision: null, source: null, ingredients: [], steps: [] });
    const parsed = parseSyncPayload(SYNC_ENTITY_RECIPE, serializeSyncPayload(payload));
    expect(parsed).toEqual(payload);
  });

  it('削除（archived）も普通の payload として運ぶ', () => {
    const payload = recipePayload();
    payload.recipe.status = 'archived';
    const parsed = parseSyncPayload(SYNC_ENTITY_RECIPE, serializeSyncPayload(payload));
    expect(parsed && 'recipe' in parsed ? parsed.recipe.status : null).toBe('archived');
  });
});

describe('sync-payload — レシピ帖', () => {
  it('往復しても中身が変わらない', () => {
    const payload = bookPayload();
    const parsed = parseSyncPayload(SYNC_ENTITY_RECIPE_BOOK, serializeSyncPayload(payload));
    expect(parsed).toEqual(payload);
  });

  it('Web 共有のトークン類を持たない', () => {
    const json = serializeSyncPayload(bookPayload());
    expect(json).not.toContain('shareSlug');
    expect(json).not.toContain('shareDeleteToken');
    expect(json).not.toContain('sharePasscode');
    expect(json).not.toContain('shareUrl');
  });
});

describe('sync-payload — 買い物の recipeId（v4 相当・版は上げない）', () => {
  function shoppingPayload(recipeId?: string | null) {
    return {
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: SYNC_ENTITY_SHOPPING_ITEM,
      item: {
        id: 's1',
        name: '卵',
        nameNormalized: '卵',
        amount: '1個',
        checked: 0,
        source: 'recipe',
        ...(recipeId !== undefined ? { recipeId } : {}),
        sortOrder: 0,
        storeGroup: null,
        createdAt: '2026-08-25T00:00:00.000Z',
        checkedAt: null,
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
    } as const;
  }

  it('recipeId を運ぶ', () => {
    const parsed = parseSyncPayload(
      SYNC_ENTITY_SHOPPING_ITEM,
      JSON.stringify(shoppingPayload('recipe-1')),
    );
    expect(parsed).not.toBeNull();
    expect((parsed as { item: { recipeId?: string | null } }).item.recipeId).toBe('recipe-1');
  });

  it('**recipeId が無い古い送信元も受けられる**（省略可にしてある）', () => {
    const parsed = parseSyncPayload(SYNC_ENTITY_SHOPPING_ITEM, JSON.stringify(shoppingPayload()));
    expect(parsed).not.toBeNull();
    expect((parsed as { item: { recipeId?: string | null } }).item.recipeId).toBeUndefined();
  });

  it('null も運べる（レシピ由来でない品目）', () => {
    const parsed = parseSyncPayload(
      SYNC_ENTITY_SHOPPING_ITEM,
      JSON.stringify(shoppingPayload(null)),
    );
    expect((parsed as { item: { recipeId?: string | null } }).item.recipeId).toBeNull();
  });

  it('版は 3 のまま。上げると公開済みの 1.11.0 が買い物の変更を丸ごと捨てる', () => {
    expect(SYNC_PAYLOAD_SCHEMA_VERSION).toBe(3);
  });
});

describe('sync-payload — 壊れた入力', () => {
  it('null・空文字は null', () => {
    expect(parseSyncPayload(SYNC_ENTITY_RECIPE, null)).toBeNull();
    expect(parseSyncPayload(SYNC_ENTITY_RECIPE, '')).toBeNull();
  });

  it('JSON として壊れていても投げない', () => {
    expect(parseSyncPayload(SYNC_ENTITY_RECIPE, '{ not json')).toBeNull();
  });

  it('必須の列が欠けていたら捨てる', () => {
    const broken = JSON.stringify({
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: SYNC_ENTITY_RECIPE,
      recipe: { id: 'r1' },
    });
    expect(parseSyncPayload(SYNC_ENTITY_RECIPE, broken)).toBeNull();
  });

  it('自分より新しい版は捨てる（知らない列を落として書き戻さない）', () => {
    const future = serializeSyncPayload({
      ...recipePayload(),
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION + 1,
    });
    expect(parseSyncPayload(SYNC_ENTITY_RECIPE, future)).toBeNull();
  });

  it('封筒の種別と中身が食い違っていたら捨てる', () => {
    expect(
      parseSyncPayload(SYNC_ENTITY_RECIPE_BOOK, serializeSyncPayload(recipePayload())),
    ).toBeNull();
    expect(parseSyncPayload(SYNC_ENTITY_RECIPE, serializeSyncPayload(bookPayload()))).toBeNull();
  });

  it('知らないエンティティ種別は捨てる', () => {
    // cooking_log は S3 の種別。いまのアプリは知らない
    expect(parseSyncPayload('cooking_log', serializeSyncPayload(recipePayload()))).toBeNull();
    expect(isSyncEntityType('cooking_log')).toBe(false);
    expect(isSyncEntityType(SYNC_ENTITY_RECIPE)).toBe(true);
    expect(isSyncEntityType('pantry_item')).toBe(true);
  });

  it('欠けている任意の列は null に寄せる（旧版の端末からの受信）', () => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      entity: SYNC_ENTITY_RECIPE,
      recipe: {
        id: 'recipe-1',
        title: 'x',
        status: 'active',
        createdAt: '2026-08-20T10:00:00.000Z',
        updatedAt: '2026-08-21T10:00:00.000Z',
      },
      ingredients: [],
      steps: [],
      tags: [],
    });
    const parsed = parseSyncPayload(SYNC_ENTITY_RECIPE, legacy);
    expect(parsed).not.toBeNull();
    if (parsed && 'recipe' in parsed) {
      expect(parsed.recipe.titleReading).toBeNull();
      expect(parsed.recipe.placeName).toBeNull();
      expect(parsed.revision).toBeNull();
      expect(parsed.source).toBeNull();
    }
  });
});

describe('sync-payload — LWW', () => {
  const older = '2026-08-21T10:00:00.000Z';
  const newer = '2026-08-21T11:00:00.000Z';

  it('ローカルに無ければ受け入れる', () => {
    expect(incomingChangeWins(older, null)).toBe(true);
  });

  it('新しい方が勝つ', () => {
    expect(incomingChangeWins(newer, older)).toBe(true);
    expect(incomingChangeWins(older, newer)).toBe(false);
  });

  it('同値は受信側（サーバー）優先', () => {
    expect(incomingChangeWins(older, older)).toBe(true);
  });

  it('壊れた時刻はローカルを守る', () => {
    expect(incomingChangeWins('not-a-date', older)).toBe(false);
    expect(incomingChangeWins(older, 'not-a-date')).toBe(true);
  });
});

describe('sync-payload — 買い物・在庫・辞書（S2）', () => {
  function shoppingPayload() {
    return {
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: SYNC_ENTITY_SHOPPING_ITEM,
      item: {
        id: 'shop-1',
        name: '牛乳',
        nameNormalized: 'ぎゅうにゅう',
        amount: '1本',
        checked: 0,
        source: 'manual',
        sortOrder: 3,
        storeGroup: 'スーパー',
        createdAt: '2026-08-20T10:00:00.000Z',
        checkedAt: null,
        updatedAt: '2026-08-22T10:00:00.000Z',
      },
    } as const;
  }

  function pantryPayload() {
    return {
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: SYNC_ENTITY_PANTRY_ITEM,
      item: {
        id: 'pantry-1',
        name: '卵',
        nameNormalized: 'たまご',
        quantity: 5,
        unit: '個',
        lowStockThreshold: 2,
        janCode: null,
        groupName: '冷蔵庫',
        expiresOn: '2026-09-01',
        createdAt: '2026-08-20T10:00:00.000Z',
        updatedAt: '2026-08-22T10:00:00.000Z',
      },
    } as const;
  }

  it('買い物の項目が往復しても変わらない', () => {
    const payload = shoppingPayload();
    expect(parseSyncPayload(SYNC_ENTITY_SHOPPING_ITEM, serializeSyncPayload(payload))).toEqual(
      payload,
    );
  });

  it('在庫の項目が往復しても変わらない（数量も運ぶ — S2-A は LWW）', () => {
    const payload = pantryPayload();
    const parsed = parseSyncPayload(SYNC_ENTITY_PANTRY_ITEM, serializeSyncPayload(payload));
    expect(parsed).toEqual(payload);
    expect(parsed && 'item' in parsed ? parsed.item : null).toMatchObject({ quantity: 5 });
  });

  it('所属・入れた人・共有フラグは運ばない', () => {
    for (const json of [
      serializeSyncPayload(shoppingPayload()),
      serializeSyncPayload(pantryPayload()),
    ]) {
      expect(json).not.toContain('familyId');
      expect(json).not.toContain('createdBy');
      expect(json).not.toContain('checkedBy');
      // サーバーに行があること自体が「共有中」を意味するので shared は運ばない
      expect(json).not.toContain('shared');
      // 受信側に無いレシピを指すと外部キーで落ちるので運ばない
      expect(json).not.toContain('recipeId');
    }
  });

  it('辞書系（名寄せ）も運べる', () => {
    const payload = {
      schemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: SYNC_ENTITY_NAME_ALIAS,
      item: {
        id: 'alias-1',
        sourceNormalized: 'たまご',
        canonical: '卵',
        updatedAt: '2026-08-22T10:00:00.000Z',
      },
    } as const;
    expect(parseSyncPayload(SYNC_ENTITY_NAME_ALIAS, serializeSyncPayload(payload))).toEqual(
      payload,
    );
  });

  it('封筒と中身の食い違いは捨てる', () => {
    expect(
      parseSyncPayload(SYNC_ENTITY_PANTRY_ITEM, serializeSyncPayload(shoppingPayload())),
    ).toBeNull();
  });

  it('自然キーを持つ種別が分かる（id で upsert すると一意制約で落ちるもの）', () => {
    expect(hasNaturalKey(SYNC_ENTITY_NAME_ALIAS)).toBe(true);
    expect(hasNaturalKey(SYNC_ENTITY_SHOPPING_ITEM)).toBe(false);
    expect(hasNaturalKey(SYNC_ENTITY_RECIPE)).toBe(false);
  });
});

describe('sync-payload — 版を上げても古い payload が読めること', () => {
  it('v1 のレシピ payload は v2 のアプリでもそのまま読める', () => {
    const v1 = JSON.stringify({ ...recipePayload(), schemaVersion: 1 });

    const parsed = parseSyncPayload(SYNC_ENTITY_RECIPE, v1);

    expect(parsed).not.toBeNull();
    expect(parsed && 'recipe' in parsed ? parsed.recipe.title : null).toBe('肉じゃが');
  });

  it('版は 3（S2-B で在庫数量の持ち分を足したため — 上げると全端末がカーソル 0 から取り直す）', () => {
    expect(SYNC_PAYLOAD_SCHEMA_VERSION).toBe(3);
  });
});

/**
 * #266: AI 由来の印は**省略可**で運ぶ。版は上げない。
 *
 * ここが崩れると、印を知らない古い端末（v3 の payload）を受け取った瞬間に
 * レシピが 1 件まるごと捨てられる。**省略可の追加で版を上げてはいけない**理由の実体。
 */
describe('AI 由来の印（#266）', () => {
  it('印が無い payload も通る（印を知らない古い端末からの受信）', () => {
    const raw = serializeSyncPayload(recipePayload());
    const parsed = parseSyncPayload(SYNC_ENTITY_RECIPE, raw) as RecipeSyncPayload | null;

    expect(parsed).not.toBeNull();
    // 未指定は「AI ではない」ではなく「分からない」。false に潰さない
    expect(parsed?.aiGenerated).toBeUndefined();
  });

  it('印が付いた payload はそのまま通る', () => {
    const raw = serializeSyncPayload(recipePayload({ aiGenerated: true }));
    const parsed = parseSyncPayload(SYNC_ENTITY_RECIPE, raw) as RecipeSyncPayload | null;

    expect(parsed?.aiGenerated).toBe(true);
  });

  it('版は据え置き（上げると旧端末がレシピを 1 件も受け取れなくなる）', () => {
    // 省略可のフィールド追加は破壊的変更ではない。上げるとカーソルが 0 に戻り、
    // 旧端末は `schemaVersion` が自分より新しい payload を全部捨てる
    expect(SYNC_PAYLOAD_SCHEMA_VERSION).toBe(3);
  });
});

/**
 * 多グループ（G-2a — docs/クラウド同期設計.md §12-3 / 共有設計 §5-4）。
 *
 * 固定したいこと:
 * - 持ち分（pantry_quantity）は**親品目の所属に従う**（別グループに割れない）
 * - 所属ゼロ＝どのグループにも送らない（G9）。既定所属は「行があり shared≠0」のときだけ（G2）
 * - ファンアウトの分配は決定的（主グループが先頭）
 * - 主グループのカーソル鍵は従来の `sync_cursor` のまま（§12-4: 移行不要の読み替え）
 */
describe('多グループ: 所属解決（entityGroupKeyOf）', () => {
  it('ふつうの種別はそのまま', () => {
    expect(entityGroupKeyOf(SYNC_ENTITY_RECIPE, 'recipe-1')).toEqual({
      entityType: SYNC_ENTITY_RECIPE,
      entityId: 'recipe-1',
    });
  });

  it('在庫数量の持ち分は親品目の所属に従う', () => {
    expect(entityGroupKeyOf('pantry_quantity', 'item-1:device-9')).toEqual({
      entityType: SYNC_ENTITY_PANTRY_ITEM,
      entityId: 'item-1',
    });
  });

  it('壊れた持ち分 id はそのまま（既定所属も付かず送られない側に倒れる）', () => {
    expect(entityGroupKeyOf('pantry_quantity', 'broken')).toEqual({
      entityType: 'pantry_quantity',
      entityId: 'broken',
    });
  });
});

describe('多グループ: 既定所属（shouldAssignDefaultGroup — G2/G9）', () => {
  it('所属が無く、行があり、shared でない 0 でなければ付ける', () => {
    expect(shouldAssignDefaultGroup({ hasMemberships: false, rowExists: true, shared: null })).toBe(
      true,
    );
    expect(shouldAssignDefaultGroup({ hasMemberships: false, rowExists: true, shared: 1 })).toBe(
      true,
    );
  });

  it('既に所属があれば付けない（既定は初回だけ）', () => {
    expect(shouldAssignDefaultGroup({ hasMemberships: true, rowExists: true, shared: null })).toBe(
      false,
    );
  });

  it('行の無い tombstone には付けない（一度も共有していない削除を外に出さない）', () => {
    expect(
      shouldAssignDefaultGroup({ hasMemberships: false, rowExists: false, shared: null }),
    ).toBe(false);
  });

  it('shared = 0（自分だけ）には付けない（G9: どのグループにも入れない）', () => {
    expect(shouldAssignDefaultGroup({ hasMemberships: false, rowExists: true, shared: 0 })).toBe(
      false,
    );
  });
});

describe('多グループ: push のファンアウト分配（planPushFanout — G3/G9）', () => {
  const entities = [
    { entityType: SYNC_ENTITY_RECIPE, entityId: 'r1' }, // 主グループのみ
    { entityType: SYNC_ENTITY_RECIPE, entityId: 'r2' }, // 両グループ
    { entityType: SYNC_ENTITY_RECIPE, entityId: 'r3' }, // 所属ゼロ（自分だけ）
    { entityType: 'pantry_quantity', entityId: 'item-1:dev-1' }, // 親品目の所属に従う
  ] as const;

  function memberships(): Map<string, readonly string[]> {
    return new Map<string, readonly string[]>([
      [entityGroupMapKey({ entityType: SYNC_ENTITY_RECIPE, entityId: 'r1' }), ['g-main']],
      [entityGroupMapKey({ entityType: SYNC_ENTITY_RECIPE, entityId: 'r2' }), ['g-sub', 'g-main']],
      [entityGroupMapKey({ entityType: SYNC_ENTITY_RECIPE, entityId: 'r3' }), []],
      [entityGroupMapKey({ entityType: SYNC_ENTITY_PANTRY_ITEM, entityId: 'item-1' }), ['g-sub']],
    ]);
  }

  it('所属グループごとに添字を分配し、主グループを先頭にする', () => {
    const plan = planPushFanout([...entities], memberships(), 'g-main');

    expect(plan.groups.map((group) => group.groupId)).toEqual(['g-main', 'g-sub']);
    expect(plan.groups[0]?.indices).toEqual([0, 1]);
    expect(plan.groups[1]?.indices).toEqual([1, 3]); // 持ち分は親品目の所属（g-sub）へ
  });

  it('所属ゼロは selfOnly（G9: どこにも送らない）', () => {
    const plan = planPushFanout([...entities], memberships(), 'g-main');

    expect(plan.selfOnlyIndices).toEqual([2]);
  });

  it('所属表に無い実体も selfOnly（安全側 — 呼び出し側は交わり済みの表を渡す）', () => {
    const plan = planPushFanout(
      [{ entityType: SYNC_ENTITY_RECIPE, entityId: 'unknown' }],
      new Map(),
      'g-main',
    );

    expect(plan.groups).toEqual([]);
    expect(plan.selfOnlyIndices).toEqual([0]);
  });

  it('同じグループが重複して並んでいても 1 回だけ送る', () => {
    const plan = planPushFanout(
      [{ entityType: SYNC_ENTITY_RECIPE, entityId: 'r1' }],
      new Map([
        [entityGroupMapKey({ entityType: SYNC_ENTITY_RECIPE, entityId: 'r1' }), ['g-a', 'g-a']],
      ]),
      'g-main',
    );

    expect(plan.groups).toEqual([{ groupId: 'g-a', indices: [0] }]);
  });
});

describe('多グループ: カーソル鍵と現在グループ（§12-4）', () => {
  it('主グループは従来の sync_cursor のまま（既存キーの読み替え＝移行不要）', () => {
    expect(syncCursorStorageKey('g-main', 'g-main')).toBe('sync_cursor');
  });

  it('他グループは sync_cursor:<groupId>', () => {
    expect(syncCursorStorageKey('g-sub', 'g-main')).toBe('sync_cursor:g-sub');
  });

  it('現在グループ: 未設定・未参加のグループ指定は主グループへ倒す', () => {
    expect(resolveCurrentGroupId(null, 'g-main', ['g-main'])).toBe('g-main');
    expect(resolveCurrentGroupId('g-gone', 'g-main', ['g-main'])).toBe('g-main');
    expect(resolveCurrentGroupId('g-sub', 'g-main', ['g-main', 'g-sub'])).toBe('g-sub');
  });
});
