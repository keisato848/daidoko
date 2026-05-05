/**
 * Database migration and seeding for v0.1 Alpha
 * Uses raw SQL for table creation (expo-sqlite doesn't support Drizzle migrations natively)
 */
import { eq, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

import * as schema from './schema';
import {
  seedCookingLogs,
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
`;

/** Run migrations (create tables) */
export function runMigrations(expoDb: { execSync: (sql: string) => void }): void {
  expoDb.execSync(CREATE_TABLES_SQL);
}

/** Seed the database with sample data */
export async function seedDatabase(database: DB): Promise<void> {
  // Check if data already exists
  const existing = await database.select().from(schema.users).limit(1);
  if (existing.length > 0) return;

  // Insert in order to satisfy foreign key constraints
  await database.insert(schema.users).values([...seedUsers]);
  await database.insert(schema.families).values([...seedFamilies]);
  await database.insert(schema.recipes).values([...seedRecipes]);
  await database.insert(schema.recipeRevisions).values([...seedRevisions]);
  await database.insert(schema.ingredients).values([...seedIngredients]);
  await database.insert(schema.steps).values([...seedSteps]);
  await database.insert(schema.tags).values([...seedTags]);
  await database.insert(schema.recipeTags).values([...seedRecipeTags]);
  await database.insert(schema.cookingLogs).values([...seedCookingLogs]);

  // Populate FTS index
  await rebuildFts(database);
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
