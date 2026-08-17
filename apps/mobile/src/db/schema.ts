/**
 * SQLite schema for だいどこ mobile app
 * Drizzle ORM (expo-sqlite) definitions
 *
 * Entities: User, Family, FamilyMember, Recipe, RecipeRevision, Ingredient, Step,
 *           Tag, RecipeTag, Source, CookingLog, CookingPhoto, Memo, SyncMeta, AppMeta
 */
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ─── User ──────────────────────���────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Family ──────────────────────��──────────────────────────────────────────
export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── FamilyMember ──────────────────────────────────────────────────────────
export const familyMembers = sqliteTable(
  'family_members',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull().default('member'), // 'owner' | 'member'
    joinedAt: text('joined_at').notNull(),
  },
  (table) => ({
    familyUserIdx: uniqueIndex('idx_family_members_family_user').on(table.familyId, table.userId),
    familyIdx: index('idx_family_members_family').on(table.familyId),
  }),
);

// ─── Source ──────────────────────────────────────���──────────────────────────
export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'url' | 'ocr' | 'manual' | 'photo'
  url: text('url'),
  ocrRawText: text('ocr_raw_text'),
  siteName: text('site_name'),
  pageTitle: text('page_title'),
  thumbnailUrl: text('thumbnail_url'),
  capturedAt: text('captured_at'),
  createdAt: text('created_at').notNull(),
});

// ─── Recipe ────────────────���──────────────────────────────────────���─────────
export const recipes = sqliteTable(
  'recipes',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    title: text('title').notNull(),
    titleReading: text('title_reading'),
    currentRevId: text('current_rev_id'),
    status: text('status').notNull().default('active'), // 'active' | 'archived'
    coverPhotoPath: text('cover_photo_path'), // 表紙写真（端末内パス, v7）
    pinnedAt: text('pinned_at'), // 作りたいリスト（ピン留め日時, v8）— null = 未ピン
    /**
     * お店の名前（v12・任意）。「あの店のあの料理」を再現する単位はレシピ 1 件なので、
     * 店名はレシピが持つ。**表示は常にここを見る。**
     * 記録（`cooking_logs.place_name`）にも列があるが、あちらは初回に入力されたときだけ
     * 埋まる履歴で、**後から店名を入れても過去の記録は変わらない** — 表示に使うと
     * 「後から入力したのに出てこない」が起きる。
     */
    placeName: text('place_name'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyStatusIdx: index('idx_recipes_family_status').on(table.familyId, table.status),
    familyUpdatedIdx: index('idx_recipes_family_updated').on(table.familyId, table.updatedAt),
  }),
);

// ─── RecipeRevision ��────────────────────────────────────────────────────────
export const recipeRevisions = sqliteTable(
  'recipe_revisions',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id),
    revisionNumber: integer('revision_number').notNull(),
    isMajor: integer('is_major', { mode: 'boolean' }).notNull().default(true),
    servings: integer('servings'),
    cookTimeMin: integer('cook_time_min'),
    prepTimeMin: integer('prep_time_min'),
    description: text('description'),
    authorNote: text('author_note'),
    sourceId: text('source_id').references(() => sources.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    recipeNumIdx: index('idx_revisions_recipe_num').on(table.recipeId, table.revisionNumber),
  }),
);

// ─── Ingredient ────────��────────────────────────────────────────────────────
export const ingredients = sqliteTable(
  'ingredients',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => recipeRevisions.id),
    sortOrder: integer('sort_order').notNull(),
    groupLabel: text('group_label'),
    name: text('name').notNull(),
    amount: text('amount'),
    note: text('note'),
  },
  (table) => ({
    revisionIdx: index('idx_ingredients_revision').on(table.revisionId),
  }),
);

// ─── Step ─────────────────���─────────────────────────────────���───────────────
export const steps = sqliteTable(
  'steps',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => recipeRevisions.id),
    sortOrder: integer('sort_order').notNull(),
    body: text('body').notNull(),
    timerSec: integer('timer_sec'),
    photoId: text('photo_id'), // 将来のクラウド写真エンティティ用（未使用）
    photoPath: text('photo_path'), // 手順写真（端末内パス, v7）
  },
  (table) => ({
    revisionIdx: index('idx_steps_revision').on(table.revisionId),
  }),
);

// ─── Tag ──────────────────��────────────────────────────��────────────────────
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    color: text('color'),
  },
  (table) => ({
    familyNameIdx: uniqueIndex('idx_tags_family_name').on(table.familyId, table.name),
  }),
);

// ─── RecipeTag (join table) ──────────���──────────────────────────────────────
export const recipeTags = sqliteTable(
  'recipe_tags',
  {
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => ({
    recipeIdx: index('idx_recipe_tags_recipe').on(table.recipeId),
    tagIdx: index('idx_recipe_tags_tag').on(table.tagId),
  }),
);

// ─── CookingLog ───────────────────────────────────────────────��─────────────
export const cookingLogs = sqliteTable(
  'cooking_logs',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    recipeId: text('recipe_id').references(() => recipes.id),
    revisionId: text('revision_id').references(() => recipeRevisions.id),
    cookedBy: text('cooked_by')
      .notNull()
      .references(() => users.id),
    cookedAt: text('cooked_at').notNull(),
    servings: integer('servings'),
    rating: integer('rating'),
    memo: text('memo'),
    createdAt: text('created_at').notNull(),
    /**
     * 体験の種類（v9）。'cooked' = 家で作った（既定）/ 'eaten_out' = 店で食べた。
     * 「食べた」も「作った」もその料理を体験した記録なので、テーブルは分けず列で区別する
     * （`docs/お店の味を再現設計.md` §3）。
     */
    kind: text('kind').notNull().default('cooked'),
    /**
     * 店名（kind='eaten_out' のとき。任意）。
     * **表示には使わない** — 表示は `recipes.place_name` を正とする（v12）。
     * ここは「その日どこで食べたか」の事実として残す。
     */
    placeName: text('place_name'),
  },
  (table) => ({
    familyDateIdx: index('idx_cooking_logs_family_date').on(table.familyId, table.cookedAt),
    recipeDateIdx: index('idx_cooking_logs_recipe_date').on(table.recipeId, table.cookedAt),
  }),
);

/** 調理記録の種類。'eaten_out' は店で食べた記録で、調理はしていない。 */
export type CookingLogKind = 'cooked' | 'eaten_out';

// ─── CookingPhoto ─────────��──────────────────────────────────��──────────────
export const cookingPhotos = sqliteTable(
  'cooking_photos',
  {
    id: text('id').primaryKey(),
    logId: text('log_id')
      .notNull()
      .references(() => cookingLogs.id),
    localPath: text('local_path').notNull(),
    cloudUrl: text('cloud_url'),
    sortOrder: integer('sort_order').notNull(),
    takenAt: text('taken_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    logIdx: index('idx_cooking_photos_log').on(table.logId),
  }),
);

// ─── Memo ───────────────���───────────────────────────────────────────────────
export const memos = sqliteTable(
  'memos',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    recipeIdx: index('idx_memos_recipe').on(table.recipeId),
  }),
);

// ─── SyncMeta ──────────────────��─────────────────────────────────���──────────
export const syncMeta = sqliteTable('sync_meta', {
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  vectorClock: text('vector_clock').notNull(), // JSON string
  deletedAt: text('deleted_at'),
  lastSyncedAt: text('last_synced_at'),
});

// ─── AppMeta ────────────────────────────────────────────────────────────────
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── FTS5 Virtual Table ────���────────────────────────────────────────────────
// Note: Drizzle ORM does not natively support FTS5. We define it via raw SQL
// in migrations/setup. This constant holds the CREATE statement for reference.
export const RECIPE_FTS_CREATE_SQL = sql`
  CREATE VIRTUAL TABLE IF NOT EXISTS recipe_fts USING fts5(
    recipe_id UNINDEXED,
    title,
    title_reading,
    ingredient_names,
    tokenize='unicode61'
  )
`;

// ─── Nutrition (future, defined for completeness) ──────────────���────────────
export const ingredientNutrition = sqliteTable('ingredient_nutrition', {
  id: text('id').primaryKey(),
  ingredientId: text('ingredient_id')
    .notNull()
    .references(() => ingredients.id)
    .unique(),
  caloriesKcal: real('calories_kcal'),
  proteinG: real('protein_g'),
  fatG: real('fat_g'),
  carbsG: real('carbs_g'),
  saltG: real('salt_g'),
  dataSource: text('data_source').notNull().default('manual'), // 'manual' | 'api' | 'estimated'
  updatedAt: text('updated_at').notNull(),
});

// ─── ShoppingItem（買い物リスト, P1）────────────────────────────────────────
// 集約買い物リスト。家族グループ単位。名前正規化キーで突合（docs/買い物リスト・在庫設計.md）。
export const shoppingItems = sqliteTable(
  'shopping_items',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    amount: text('amount'),
    checked: integer('checked').notNull().default(0),
    source: text('source').notNull().default('manual'), // 'manual' | 'recipe' | 'low_stock' | 'receipt'
    recipeId: text('recipe_id').references(() => recipes.id),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    checkedAt: text('checked_at'),
  },
  (table) => ({
    familyCheckedIdx: index('idx_shopping_items_family_checked').on(table.familyId, table.checked),
  }),
);

// ─── PantryItem（在庫, P2）──────────────────────────────────────────────────
// 家の在庫。数量×単位は厳密管理（同一商品は合算）。包装品は jan_code で識別（P2b）。
export const pantryItems = sqliteTable(
  'pantry_items',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    lowStockThreshold: real('low_stock_threshold'),
    janCode: text('jan_code'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyNameIdx: index('idx_pantry_items_family_name').on(table.familyId, table.nameNormalized),
  }),
);

// ─── JanCatalog（JAN→商品名の記憶, P2b）─────────────────────────────────────
// バーコード(JAN)→名前/単位 のローカル辞書。初回入力で記憶し、次回スキャンで自動補完。
export const janCatalog = sqliteTable(
  'jan_catalog',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    janCode: text('jan_code').notNull(),
    name: text('name').notNull(),
    unit: text('unit'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyJanIdx: uniqueIndex('idx_jan_catalog_family_jan').on(table.familyId, table.janCode),
  }),
);

// ─── NameAlias（AI名寄せキャッシュ, name-matching）─────────────────────────────
// 正規化名 → 正規食材名（canonical）のキャッシュ。AI で一度解決して記憶し、以降の
// 在庫⇄レシピ突合に使う。辞書はソースに持たず、ここ（データ）に蓄積する。
export const nameAliases = sqliteTable(
  'name_aliases',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    sourceNormalized: text('source_normalized').notNull(),
    canonical: text('canonical').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familySourceIdx: uniqueIndex('idx_name_aliases_family_source').on(
      table.familyId,
      table.sourceNormalized,
    ),
  }),
);

// ─── RecipeBook（レシピ帖, S4 — docs/Web共有設計.md §7）───────────────────────
// 帖はローカルの実体。共有は任意の後続で、share_* が NULL なら未共有。
// share_delete_token は取り消し＋更新（PATCH）の鍵 — 端末外に出さない。
export const recipeBooks = sqliteTable('recipe_books', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  shareSlug: text('share_slug'),
  shareUrl: text('share_url'),
  shareDeleteToken: text('share_delete_token'),
  sharedAt: text('shared_at'),
  shareLocale: text('share_locale'),
  /** 公開の強度（S4-2）。パスコードは更新時に再送するため平文で持つ（端末内のみ） */
  sharePasscode: text('share_passcode'),
  shareExpiresAt: text('share_expires_at'),
  /** S2（app_meta 時代）に公開した帖 — 収録レシピ不明。停止のみ可 */
  isLegacyShare: integer('is_legacy_share').notNull().default(0),
});

export const recipeBookItems = sqliteTable(
  'recipe_book_items',
  {
    bookId: text('book_id')
      .notNull()
      .references(() => recipeBooks.id),
    recipeId: text('recipe_id').notNull(),
    position: integer('position').notNull(),
  },
  (table) => ({
    bookRecipeIdx: uniqueIndex('idx_recipe_book_items_book_recipe').on(
      table.bookId,
      table.recipeId,
    ),
  }),
);
