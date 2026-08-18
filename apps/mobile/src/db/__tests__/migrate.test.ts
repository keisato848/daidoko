import {
  CURRENT_SCHEMA_VERSION,
  runMigrations,
  type SeedSnapshot,
  shouldInstallSampleData,
} from '../migrate';
import { seedCookingLogs, seedRecipes, seedUsers } from '../seed';

function snapshot(overrides: Partial<SeedSnapshot> = {}): SeedSnapshot {
  return {
    userIds: [],
    familyIds: [],
    recipeIds: [],
    revisionIds: [],
    ingredientIds: [],
    stepIds: [],
    tagIds: [],
    cookingLogIds: [],
    cookingPhotoIds: [],
    shoppingItemIds: [],
    ...overrides,
  };
}

describe('database migrations', () => {
  it('marks the SQLite schema version after table creation', () => {
    const statements: string[] = [];

    const result = runMigrations({
      execSync: (statement) => statements.push(statement),
    });

    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS family_members');
    expect(statements).toContain(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
  });

  it('adds v7 photo columns and survives duplicate-column errors on re-run', () => {
    const statements: string[] = [];

    const result = runMigrations({
      execSync: (statement) => {
        statements.push(statement);
        // Simulate an already-migrated DB: every ALTER fails as duplicate.
        if (statement.startsWith('ALTER TABLE')) {
          throw new Error('duplicate column name');
        }
      },
    });

    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(statements).toContain('ALTER TABLE recipes ADD COLUMN cover_photo_path TEXT');
    expect(statements).toContain('ALTER TABLE steps ADD COLUMN photo_path TEXT');
    expect(statements).toContain(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
  });

  it('v12: レシピに店名の列を足し、記録に入っている店名を引き継ぐ', () => {
    const statements: string[] = [];

    runMigrations({ execSync: (statement) => statements.push(statement) });

    expect(statements).toContain('ALTER TABLE recipes ADD COLUMN place_name TEXT');
    // 記録 → レシピ の移送。**空で上書きしない**ことと、
    // 既にレシピ側に値があれば触らないことが要（後から入力し直せるため）
    const backfill = statements.find((s) => s.includes('UPDATE recipes SET place_name'));
    expect(backfill).toBeDefined();
    expect(backfill).toContain('FROM cooking_logs');
    expect(backfill).toContain("TRIM(l.place_name) <> ''");
    expect(backfill).toContain('ORDER BY l.cooked_at ASC');
    expect(backfill).toMatch(/WHERE \(place_name IS NULL OR TRIM\(place_name\) = ''\)/);
  });

  it('店名の引き継ぎが失敗しても移行は止まらない（列がまだ無い等）', () => {
    const result = runMigrations({
      execSync: (statement) => {
        if (statement.includes('UPDATE recipes SET place_name')) {
          throw new Error('no such column: place_name');
        }
      },
    });

    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('sample data seed guard', () => {
  it('installs sample data into an empty database', () => {
    expect(shouldInstallSampleData(snapshot())).toBe(true);
  });

  it('continues an interrupted seed when only known sample rows exist', () => {
    expect(
      shouldInstallSampleData(
        snapshot({
          userIds: [seedUsers[0].id],
          recipeIds: [seedRecipes[0].id],
          cookingLogIds: [seedCookingLogs[0].id],
        }),
      ),
    ).toBe(true);
  });

  it('does not install sample data over user-created recipes', () => {
    expect(
      shouldInstallSampleData(
        snapshot({
          userIds: [seedUsers[0].id],
          recipeIds: [seedRecipes[0].id, 'recipe-user-created'],
        }),
      ),
    ).toBe(false);
  });

  it('does not install sample data over user-created cooking logs', () => {
    expect(
      shouldInstallSampleData(
        snapshot({
          userIds: [seedUsers[0].id],
          cookingLogIds: [seedCookingLogs[0].id, 'log-user-created'],
        }),
      ),
    ).toBe(false);
  });
});
