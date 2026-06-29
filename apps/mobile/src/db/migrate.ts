/**
 * Database migration and optional sample seeding
 * Uses raw SQL for table creation (expo-sqlite doesn't support Drizzle migrations natively)
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

import * as schema from './schema';
import { isSampleDataEnabled } from './sampleData';
import {
  seedCookingLogs,
  seedCookingPhotos,
  seedFamilies,
  seedIngredients,
  seedRecipeTags,
  seedRecipes,
  seedRevisions,
  seedSteps,
  seedTags,
  seedUsers,
} from './seed';

type DB = ExpoSQLiteDatabase<typeof schema>;

export const CURRENT_SCHEMA_VERSION = 3;

const DEFAULT_USER_ID = 'user-kei';
const DEFAULT_FAMILY_ID = 'family-001';
const DEFAULT_MEMBER_ID = 'member-family-001-user-kei';
const DEFAULT_USER_NAME = '';
const DEFAULT_FAMILY_NAME = 'わたしの台所';
const DEFAULT_INVITE_CODE = 'DK0001';

const SAMPLE_DATA_VERSION = '1';
const SAMPLE_DATA_META_KEY = 'sample_data_version';

export interface SeedSnapshot {
  userIds: string[];
  familyIds: string[];
  recipeIds: string[];
  revisionIds: string[];
  ingredientIds: string[];
  stepIds: string[];
  tagIds: string[];
  cookingLogIds: string[];
  cookingPhotoIds: string[];
}

export interface MigrationResult {
  schemaVersion: number;
}

const seedIdSets = {
  userIds: new Set(seedUsers.map((item) => item.id)),
  familyIds: new Set(seedFamilies.map((item) => item.id)),
  recipeIds: new Set(seedRecipes.map((item) => item.id)),
  revisionIds: new Set(seedRevisions.map((item) => item.id)),
  ingredientIds: new Set(seedIngredients.map((item) => item.id)),
  stepIds: new Set(seedSteps.map((item) => item.id)),
  tagIds: new Set(seedTags.map((item) => item.id)),
  cookingLogIds: new Set(seedCookingLogs.map((item) => item.id)),
  cookingPhotoIds: new Set(seedCookingPhotos.map((item) => item.id)),
} satisfies Record<keyof SeedSnapshot, Set<string>>;

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS families (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS family_members (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL,
    UNIQUE(family_id, user_id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_family_user ON family_members(family_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_family_members_family ON family_members(family_id);

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    url TEXT,
    ocr_raw_text TEXT,
    site_name TEXT,
    page_title TEXT,
    thumbnail_url TEXT,
    captured_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    title TEXT NOT NULL,
    title_reading TEXT,
    current_rev_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_recipes_family_status ON recipes(family_id, status);
  CREATE INDEX IF NOT EXISTS idx_recipes_family_updated ON recipes(family_id, updated_at);

  CREATE TABLE IF NOT EXISTS recipe_revisions (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL REFERENCES recipes(id),
    revision_number INTEGER NOT NULL,
    is_major INTEGER NOT NULL DEFAULT 1,
    servings INTEGER,
    cook_time_min INTEGER,
    prep_time_min INTEGER,
    description TEXT,
    author_note TEXT,
    source_id TEXT REFERENCES sources(id),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_revisions_recipe_num ON recipe_revisions(recipe_id, revision_number);

  CREATE TABLE IF NOT EXISTS ingredients (
    id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES recipe_revisions(id),
    sort_order INTEGER NOT NULL,
    group_label TEXT,
    name TEXT NOT NULL,
    amount TEXT,
    note TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_ingredients_revision ON ingredients(revision_id);

  CREATE TABLE IF NOT EXISTS steps (
    id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES recipe_revisions(id),
    sort_order INTEGER NOT NULL,
    body TEXT NOT NULL,
    timer_sec INTEGER,
    photo_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_steps_revision ON steps(revision_id);

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    name TEXT NOT NULL,
    color TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_family_name ON tags(family_id, name);

  CREATE TABLE IF NOT EXISTS recipe_tags (
    recipe_id TEXT NOT NULL REFERENCES recipes(id),
    tag_id TEXT NOT NULL REFERENCES tags(id),
    PRIMARY KEY (recipe_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_recipe_tags_recipe ON recipe_tags(recipe_id);
  CREATE INDEX IF NOT EXISTS idx_recipe_tags_tag ON recipe_tags(tag_id);

  CREATE TABLE IF NOT EXISTS cooking_logs (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    recipe_id TEXT REFERENCES recipes(id),
    revision_id TEXT REFERENCES recipe_revisions(id),
    cooked_by TEXT NOT NULL REFERENCES users(id),
    cooked_at TEXT NOT NULL,
    servings INTEGER,
    rating INTEGER,
    memo TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cooking_logs_family_date ON cooking_logs(family_id, cooked_at);
  CREATE INDEX IF NOT EXISTS idx_cooking_logs_recipe_date ON cooking_logs(recipe_id, cooked_at);

  CREATE TABLE IF NOT EXISTS cooking_photos (
    id TEXT PRIMARY KEY,
    log_id TEXT NOT NULL REFERENCES cooking_logs(id),
    local_path TEXT NOT NULL,
    cloud_url TEXT,
    sort_order INTEGER NOT NULL,
    taken_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cooking_photos_log ON cooking_photos(log_id);

  CREATE TABLE IF NOT EXISTS memos (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL REFERENCES recipes(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    is_private INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_memos_recipe ON memos(recipe_id);

  CREATE TABLE IF NOT EXISTS sync_meta (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    vector_clock TEXT NOT NULL,
    deleted_at TEXT,
    last_synced_at TEXT,
    PRIMARY KEY (entity_type, entity_id)
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ingredient_nutrition (
    id TEXT PRIMARY KEY,
    ingredient_id TEXT NOT NULL UNIQUE REFERENCES ingredients(id),
    calories_kcal REAL,
    protein_g REAL,
    fat_g REAL,
    carbs_g REAL,
    salt_g REAL,
    data_source TEXT NOT NULL DEFAULT 'manual',
    updated_at TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS recipe_fts USING fts5(
    recipe_id UNINDEXED,
    title,
    title_reading,
    ingredient_names,
    tokenize='unicode61'
  );

  CREATE TABLE IF NOT EXISTS shopping_items (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    amount TEXT,
    checked INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    recipe_id TEXT REFERENCES recipes(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    checked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_shopping_items_family_checked ON shopping_items(family_id, checked);
`;

/** Run migrations (create tables) */
export function runMigrations(expoDb: { execSync: (sql: string) => void }): MigrationResult {
  expoDb.execSync(CREATE_TABLES_SQL);
  expoDb.execSync(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
  return { schemaVersion: CURRENT_SCHEMA_VERSION };
}

export async function ensureLocalIdentity(database: DB): Promise<void> {
  const now = new Date().toISOString();

  await database
    .insert(schema.users)
    .values({
      id: DEFAULT_USER_ID,
      displayName: DEFAULT_USER_NAME,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await database
    .insert(schema.families)
    .values({
      id: DEFAULT_FAMILY_ID,
      name: DEFAULT_FAMILY_NAME,
      inviteCode: DEFAULT_INVITE_CODE,
      ownerId: DEFAULT_USER_ID,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const existingMembers = await database
    .select({ id: schema.familyMembers.id })
    .from(schema.familyMembers)
    .where(eq(schema.familyMembers.familyId, DEFAULT_FAMILY_ID));

  if (!isSampleDataEnabled()) {
    await database
      .update(schema.users)
      .set({ displayName: DEFAULT_USER_NAME, updatedAt: now })
      .where(
        and(
          eq(schema.users.id, DEFAULT_USER_ID),
          inArray(schema.users.displayName, ['恵', 'あなた']),
        ),
      );
  }

  if (existingMembers.length === 0 && !isSampleDataEnabled()) {
    await database
      .update(schema.families)
      .set({ name: DEFAULT_FAMILY_NAME, inviteCode: DEFAULT_INVITE_CODE, updatedAt: now })
      .where(
        and(eq(schema.families.id, DEFAULT_FAMILY_ID), eq(schema.families.name, '佐藤家の台所')),
      );
  }

  await database
    .insert(schema.familyMembers)
    .values({
      id: DEFAULT_MEMBER_ID,
      familyId: DEFAULT_FAMILY_ID,
      userId: DEFAULT_USER_ID,
      role: 'owner',
      joinedAt: now,
    })
    .onConflictDoNothing();
}

function isSubsetOfSeed(ids: string[], seedIds: Set<string>): boolean {
  return ids.every((id) => seedIds.has(id));
}

export function shouldInstallSampleData(snapshot: SeedSnapshot): boolean {
  const allIds = Object.values(snapshot).flat();
  if (allIds.length === 0) return true;

  return (Object.keys(seedIdSets) as (keyof SeedSnapshot)[]).every((key) =>
    isSubsetOfSeed(snapshot[key], seedIdSets[key]),
  );
}

async function getSeedSnapshot(database: DB): Promise<SeedSnapshot> {
  const users = await database.select({ id: schema.users.id }).from(schema.users);
  const families = await database.select({ id: schema.families.id }).from(schema.families);
  const recipes = await database.select({ id: schema.recipes.id }).from(schema.recipes);
  const revisions = await database
    .select({ id: schema.recipeRevisions.id })
    .from(schema.recipeRevisions);
  const ingredients = await database.select({ id: schema.ingredients.id }).from(schema.ingredients);
  const steps = await database.select({ id: schema.steps.id }).from(schema.steps);
  const tags = await database.select({ id: schema.tags.id }).from(schema.tags);
  const cookingLogs = await database.select({ id: schema.cookingLogs.id }).from(schema.cookingLogs);
  const cookingPhotos = await database
    .select({ id: schema.cookingPhotos.id })
    .from(schema.cookingPhotos);

  return {
    userIds: users.map((item) => item.id),
    familyIds: families.map((item) => item.id),
    recipeIds: recipes.map((item) => item.id),
    revisionIds: revisions.map((item) => item.id),
    ingredientIds: ingredients.map((item) => item.id),
    stepIds: steps.map((item) => item.id),
    tagIds: tags.map((item) => item.id),
    cookingLogIds: cookingLogs.map((item) => item.id),
    cookingPhotoIds: cookingPhotos.map((item) => item.id),
  };
}

async function markSampleDataVersion(database: DB): Promise<void> {
  await database
    .insert(schema.appMeta)
    .values({
      key: SAMPLE_DATA_META_KEY,
      value: SAMPLE_DATA_VERSION,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: schema.appMeta.key,
      set: {
        value: SAMPLE_DATA_VERSION,
        updatedAt: new Date().toISOString(),
      },
    });
}

/** Seed the database with sample data */
export async function seedDatabase(database: DB): Promise<void> {
  if (!isSampleDataEnabled()) return;

  const seedMeta = await database
    .select({ value: schema.appMeta.value })
    .from(schema.appMeta)
    .where(eq(schema.appMeta.key, SAMPLE_DATA_META_KEY))
    .limit(1);
  if (seedMeta[0]?.value === SAMPLE_DATA_VERSION) return;

  const snapshot = await getSeedSnapshot(database);
  if (!shouldInstallSampleData(snapshot)) {
    await markSampleDataVersion(database);
    return;
  }

  // Insert in order to satisfy foreign key constraints
  await database
    .insert(schema.users)
    .values([...seedUsers])
    .onConflictDoNothing();
  await database
    .insert(schema.families)
    .values([...seedFamilies])
    .onConflictDoNothing();
  await database
    .insert(schema.recipes)
    .values([...seedRecipes])
    .onConflictDoNothing();
  await database
    .insert(schema.recipeRevisions)
    .values([...seedRevisions])
    .onConflictDoNothing();
  await database
    .insert(schema.ingredients)
    .values([...seedIngredients])
    .onConflictDoNothing();
  await database
    .insert(schema.steps)
    .values([...seedSteps])
    .onConflictDoNothing();
  await database
    .insert(schema.tags)
    .values([...seedTags])
    .onConflictDoNothing();
  await database
    .insert(schema.recipeTags)
    .values([...seedRecipeTags])
    .onConflictDoNothing();
  await database
    .insert(schema.cookingLogs)
    .values([...seedCookingLogs])
    .onConflictDoNothing();
  await database
    .insert(schema.cookingPhotos)
    .values([...seedCookingPhotos])
    .onConflictDoNothing();

  // Populate FTS index
  await rebuildFts(database);
  await markSampleDataVersion(database);
}

/** Rebuild FTS5 index from current recipe data */
export async function rebuildFts(database: DB): Promise<void> {
  // Clear existing FTS data
  await database.run(sql`DELETE FROM recipe_fts`);

  // Get all recipes
  const allRecipes = await database.select().from(schema.recipes);

  for (const recipe of allRecipes) {
    if (!recipe.currentRevId) continue;

    // Get ingredients for this recipe's current revision
    const recipeIngredients = await database
      .select({ name: schema.ingredients.name })
      .from(schema.ingredients)
      .where(eq(schema.ingredients.revisionId, recipe.currentRevId));

    const ingredientNames = recipeIngredients.map((i) => i.name).join(' ');

    // Insert into FTS
    await database.run(
      sql`INSERT INTO recipe_fts (recipe_id, title, title_reading, ingredient_names)
          VALUES (${recipe.id}, ${recipe.title}, ${recipe.titleReading ?? ''}, ${ingredientNames})`,
    );
  }
}
