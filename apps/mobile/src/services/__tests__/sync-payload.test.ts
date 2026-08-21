/**
 * 同期ペイロードの純関数（S1 — docs/クラウド同期設計.md §5-1b）。
 *
 * 固定したいこと:
 * - **写真パスが payload に混ざらない**（写真は S3。混ざると受信側の写真を消す）
 * - 壊れた・新しすぎる payload は例外ではなく null（1 件捨てて同期は続く）
 * - LWW は updatedAt 基準・同値は受信側（サーバー）優先
 */
import {
  SYNC_ENTITY_RECIPE,
  SYNC_ENTITY_RECIPE_BOOK,
  SYNC_PAYLOAD_SCHEMA_VERSION,
  incomingChangeWins,
  isSyncEntityType,
  parseSyncPayload,
  serializeSyncPayload,
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
      pinnedAt: null,
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
    expect(parseSyncPayload('pantry_item', serializeSyncPayload(recipePayload()))).toBeNull();
    expect(isSyncEntityType('pantry_item')).toBe(false);
    expect(isSyncEntityType(SYNC_ENTITY_RECIPE)).toBe(true);
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
