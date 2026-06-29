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
    photoId: text('photo_id'),
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
  },
  (table) => ({
    familyDateIdx: index('idx_cooking_logs_family_date').on(table.familyId, table.cookedAt),
    recipeDateIdx: index('idx_cooking_logs_recipe_date').on(table.recipeId, table.cookedAt),
  }),
);

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
