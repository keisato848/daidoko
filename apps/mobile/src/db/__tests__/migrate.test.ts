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
