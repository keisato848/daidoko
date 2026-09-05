import {
  BACKUP_TABLES,
  createMigrationPhotoArchivePath,
  createMigrationRecipePhotoArchivePath,
  formatBackupFileName,
  formatMigrationBackupFileName,
  parseMigrationBackupManifest,
  parseLocalBackupPayload,
  pickLatestBackup,
  selectBackupsToPrune,
  shouldCreateAutoSnapshot,
  type BackupFileSummary,
} from '../backup.service';
import { ADD_COLUMN_MIGRATIONS } from '../../db/migrate';

const emptyTables = {
  users: [],
  families: [],
  family_members: [],
  sources: [],
  recipes: [],
  recipe_revisions: [],
  ingredients: [],
  steps: [],
  tags: [],
  recipe_tags: [],
  cooking_logs: [],
  cooking_photos: [],
  memos: [],
  sync_meta: [],
  app_meta: [],
};

/**
 * バックアップ対象の取りこぼしは、**気づくのが復元のときになる**（そのときには手遅れ）。
 * 実際に pantry 系4テーブルがまるごと漏れていた（PR #109）。
 * 列を足したのにここを直し忘れる事故を、テストで止める。
 */
/**
 * 後から足した NOT NULL 列は、旧ファイルの復元を**丸ごと**落とす（値を `?? null` で
 * 明示的に束縛するので DEFAULT が効かない）。実際に `cooking_logs.kind` がそうなっていて、
 * 1.4.3 以前の移行 ZIP が一件も復元できなかった（2026-08-22 のレビューで発見）。
 */
describe('後から足した NOT NULL 列には復元用の既定値がある', () => {
  const notNullAdded = ADD_COLUMN_MIGRATIONS.filter((m) => /NOT NULL/i.test(m.columnDdl)).map(
    (m) => ({ table: m.table, column: m.columnDdl.trim().split(/\s+/)[0] ?? '' }),
  );

  it('ADD COLUMN の NOT NULL 列が 1 つ以上ある（テストが空回りしていない）', () => {
    expect(notNullAdded.length).toBeGreaterThan(0);
  });

  it.each(notNullAdded)('$table.$column に defaults がある', ({ table, column }) => {
    const def = BACKUP_TABLES.find((entry) => entry.name === table) as
      | { columns: readonly string[]; defaults?: Readonly<Record<string, string | number>> }
      | undefined;
    if (!def) return; // 対象外のテーブルは復元しないので関係ない
    if (!def.columns.includes(column)) return;
    expect(def.defaults?.[column]).toBeDefined();
  });
});

describe('バックアップ対象の取りこぼし防止', () => {
  const columnsOf = (table: string): string[] =>
    BACKUP_TABLES.find((entry) => entry.name === table)?.columns ?? [];

  it('全テーブルが対象に入っている', () => {
    expect(BACKUP_TABLES.map((entry) => entry.name).sort()).toEqual(
      [
        'app_meta',
        'cooking_logs',
        'cooking_photos',
        'families',
        'family_members',
        'ingredients',
        'jan_catalog',
        'memos',
        'menu_plan_days',
        'menu_plans',
        'name_aliases',
        'pantry_items',
        'pantry_quantity_parts',
        'recipe_book_items',
        'recipe_books',
        'recipe_revisions',
        'recipe_tags',
        'recipes',
        'shopping_items',
        'sources',
        'steps',
        'store_group_aliases',
        'sync_meta',
        'tags',
        'users',
      ].sort(),
    );
  });

  it('R1 で足した cooking_logs.kind / place_name が入っている', () => {
    expect(columnsOf('cooking_logs')).toEqual(expect.arrayContaining(['kind', 'place_name']));
  });

  it('v12 の recipes.place_name が入っている（復元でお店の名前が消えないため）', () => {
    expect(columnsOf('recipes')).toContain('place_name');
  });

  it('v17 の recipes.ai_generated が入っている（復元で AI の印が消えないため・#266）', () => {
    // 落とすと、バックアップから戻した瞬間に安全表示だけが静かに消える。
    // 在庫 4 テーブルがまるごと漏れた前例があるので、列ごとに固定する
    expect(columnsOf('recipes')).toContain('ai_generated');
  });

  it('v13 のグループ・賞味期限・誰が が入っている（復元で消えないため）', () => {
    expect(columnsOf('pantry_items')).toEqual(expect.arrayContaining(['group_name', 'expires_on']));
    // v15: 同期の列もバックアップに含める（落とすと復元で共有設定が消える）
    expect(columnsOf('pantry_items')).toEqual(expect.arrayContaining(['shared']));
    expect(columnsOf('shopping_items')).toEqual(expect.arrayContaining(['updated_at', 'shared']));
    expect(columnsOf('shopping_items')).toEqual(
      expect.arrayContaining(['store_group', 'created_by', 'checked_by']),
    );
    // 店の学習（レシートの店名→買い物グループ）も消えては困る
    expect(columnsOf('store_group_aliases')).toEqual(
      expect.arrayContaining(['store_name', 'group_name']),
    );
  });

  it('v19 の献立テーブルが入っている（復元で献立が消えないため）', () => {
    // 親（menu_plans）→ 子（menu_plan_days）の順であること — 復元の INSERT はこの並び順
    const names = BACKUP_TABLES.map((entry) => entry.name);
    expect(names.indexOf('menu_plans')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('menu_plans')).toBeLessThan(names.indexOf('menu_plan_days'));
    expect(columnsOf('menu_plans')).toEqual(
      expect.arrayContaining([
        'meal_time',
        'generated_at',
        'anchor_date',
        'requested_days',
        'auto_added_item_ids',
      ]),
    );
    expect(columnsOf('menu_plan_days')).toEqual(
      expect.arrayContaining(['plan_id', 'day', 'recipe_id', 'title', 'reason', 'done_at']),
    );
  });

  it('写真パスの列が入っている（復元後に写真が見えなくなるのを防ぐ）', () => {
    expect(columnsOf('recipes')).toContain('cover_photo_path');
    expect(columnsOf('steps')).toContain('photo_path');
    expect(columnsOf('cooking_photos')).toContain('local_path');
  });

  it('R2 の感想が残る author_note が入っている', () => {
    expect(columnsOf('recipe_revisions')).toContain('author_note');
  });

  it('作りたいリストの pinned_at が入っている', () => {
    expect(columnsOf('recipes')).toContain('pinned_at');
  });
});

describe('backup.service', () => {
  it('formats backup file names with local timestamp components', () => {
    const date = new Date(2026, 4, 30, 7, 8, 9);
    expect(formatBackupFileName(date)).toBe('daidoko-backup-20260530-070809.json');
  });

  it('formats migration backup file names with local timestamp components', () => {
    const date = new Date(2026, 4, 30, 7, 8, 9);
    expect(formatMigrationBackupFileName(date)).toBe(
      'daidoko-transfer-20260530-070809.daidoko.zip',
    );
  });

  it('creates safe archive paths for migration photos', () => {
    expect(createMigrationPhotoArchivePath('photo:1', 'file:///tmp/cooking photo.jpg')).toBe(
      'cooking-photos/photo_1-cooking_photo.jpg',
    );
  });

  it('parses a valid local backup payload', () => {
    const payload = parseLocalBackupPayload(
      JSON.stringify({
        format: 'daidoko.local-backup',
        schemaVersion: 1,
        exportedAt: '2026-05-30T00:00:00.000Z',
        tables: emptyTables,
      }),
    );

    expect(payload.format).toBe('daidoko.local-backup');
    expect(payload.schemaVersion).toBe(1);
  });

  it('treats a payload without the pantry tables as empty (旧形式バックアップ互換)', () => {
    // emptyTables = 2026-07 以前の 15 テーブルのみ。復元できなくなってはいけない
    const payload = parseLocalBackupPayload(
      JSON.stringify({
        format: 'daidoko.local-backup',
        schemaVersion: 1,
        exportedAt: '2026-05-30T00:00:00.000Z',
        tables: emptyTables,
      }),
    );

    expect(payload.tables.pantry_items).toEqual([]);
    expect(payload.tables.shopping_items).toEqual([]);
    expect(payload.tables.jan_catalog).toEqual([]);
    expect(payload.tables.name_aliases).toEqual([]);
  });

  it('round-trips the pantry / shopping / alias tables', () => {
    const payload = parseLocalBackupPayload(
      JSON.stringify({
        format: 'daidoko.local-backup',
        schemaVersion: 1,
        exportedAt: '2026-07-30T00:00:00.000Z',
        tables: {
          ...emptyTables,
          pantry_items: [
            {
              id: 'pantry-1',
              family_id: 'family-1',
              name: '玉ねぎ',
              name_normalized: 'たまねぎ',
              quantity: 2,
              unit: '個',
              low_stock_threshold: 1,
              jan_code: null,
              created_at: '2026-07-30T00:00:00.000Z',
              updated_at: '2026-07-30T00:00:00.000Z',
            },
          ],
          shopping_items: [
            {
              id: 'shopping-1',
              family_id: 'family-1',
              name: '牛乳',
              name_normalized: 'ぎゅうにゅう',
              amount: '1本',
              checked: 0,
              source: 'low_stock',
              recipe_id: null,
              sort_order: 0,
              created_at: '2026-07-30T00:00:00.000Z',
              checked_at: null,
            },
          ],
          jan_catalog: [
            {
              id: 'jan-1',
              family_id: 'family-1',
              jan_code: '4901234567894',
              name: '牛乳 1L',
              unit: '本',
              updated_at: '2026-07-30T00:00:00.000Z',
            },
          ],
          name_aliases: [
            {
              id: 'alias-1',
              family_id: 'family-1',
              source_normalized: 'たまねき',
              canonical: '玉ねぎ',
              updated_at: '2026-07-30T00:00:00.000Z',
            },
          ],
        },
      }),
    );

    expect(payload.tables.pantry_items[0]?.name).toBe('玉ねぎ');
    expect(payload.tables.shopping_items[0]?.source).toBe('low_stock');
    expect(payload.tables.jan_catalog[0]?.jan_code).toBe('4901234567894');
    expect(payload.tables.name_aliases[0]?.canonical).toBe('玉ねぎ');
  });

  it('rejects a pantry table that is present but malformed', () => {
    expect(() =>
      parseLocalBackupPayload(
        JSON.stringify({
          format: 'daidoko.local-backup',
          schemaVersion: 1,
          exportedAt: '2026-07-30T00:00:00.000Z',
          tables: { ...emptyTables, pantry_items: 'broken' },
        }),
      ),
    ).toThrow('pantry_items のバックアップ内容が不正です');
  });

  it('rejects unknown backup schema versions', () => {
    expect(() =>
      parseLocalBackupPayload(
        JSON.stringify({
          format: 'daidoko.local-backup',
          schemaVersion: 999,
          exportedAt: '2026-05-30T00:00:00.000Z',
          tables: {},
        }),
      ),
    ).toThrow('対応していないバックアップ形式です');
  });

  it('parses migration backup manifests', () => {
    const manifest = parseMigrationBackupManifest(
      JSON.stringify({
        format: 'daidoko.migration-backup',
        schemaVersion: 1,
        exportedAt: '2026-05-30T00:00:00.000Z',
        backup: {
          format: 'daidoko.local-backup',
          schemaVersion: 1,
          exportedAt: '2026-05-30T00:00:00.000Z',
          tables: emptyTables,
        },
        photos: [
          {
            id: 'photo-1',
            archivePath: 'cooking-photos/photo-1.jpg',
            fileName: 'photo-1.jpg',
            originalLocalPath: 'file:///old/photo-1.jpg',
          },
        ],
      }),
    );

    expect(manifest.format).toBe('daidoko.migration-backup');
    expect(manifest.photos[0]?.archivePath).toBe('cooking-photos/photo-1.jpg');
  });

  it('rejects migration photo paths outside the archive photo directory', () => {
    expect(() =>
      parseMigrationBackupManifest(
        JSON.stringify({
          format: 'daidoko.migration-backup',
          schemaVersion: 1,
          exportedAt: '2026-05-30T00:00:00.000Z',
          backup: {
            format: 'daidoko.local-backup',
            schemaVersion: 1,
            exportedAt: '2026-05-30T00:00:00.000Z',
            tables: emptyTables,
          },
          photos: [
            {
              id: 'photo-1',
              archivePath: '../photo-1.jpg',
              fileName: 'photo-1.jpg',
              originalLocalPath: 'file:///old/photo-1.jpg',
            },
          ],
        }),
      ),
    ).toThrow('写真バックアップのパスが不正です');
  });

  it('creates safe archive paths for recipe cover/step photos', () => {
    expect(
      createMigrationRecipePhotoArchivePath('recipe-cover', 'recipe:1', 'file:///tmp/my cover.jpg'),
    ).toBe('recipe-photos/cover-recipe_1-my_cover.jpg');
    expect(createMigrationRecipePhotoArchivePath('step', 'step-9', 'file:///tmp/s.png')).toBe(
      'recipe-photos/step-step-9-s.png',
    );
  });

  it('parses manifests with the optional recipePhotos extension', () => {
    const manifest = parseMigrationBackupManifest(
      JSON.stringify({
        format: 'daidoko.migration-backup',
        schemaVersion: 1,
        exportedAt: '2026-07-07T00:00:00.000Z',
        backup: {
          format: 'daidoko.local-backup',
          schemaVersion: 1,
          exportedAt: '2026-07-07T00:00:00.000Z',
          tables: emptyTables,
        },
        photos: [],
        recipePhotos: [
          {
            ownerType: 'recipe-cover',
            ownerId: 'recipe-1',
            archivePath: 'recipe-photos/cover-recipe-1-c.jpg',
            fileName: 'cover-recipe-1-c.jpg',
            originalLocalPath: 'file:///old/c.jpg',
          },
          {
            ownerType: 'step',
            ownerId: 'step-2',
            archivePath: 'recipe-photos/step-step-2-s.jpg',
            fileName: 'step-step-2-s.jpg',
            originalLocalPath: 'file:///old/s.jpg',
          },
        ],
      }),
    );

    expect(manifest.recipePhotos).toHaveLength(2);
    expect(manifest.recipePhotos?.[0]?.ownerType).toBe('recipe-cover');
  });

  it('treats manifests without recipePhotos as empty (旧形式 ZIP 互換)', () => {
    const manifest = parseMigrationBackupManifest(
      JSON.stringify({
        format: 'daidoko.migration-backup',
        schemaVersion: 1,
        exportedAt: '2026-07-07T00:00:00.000Z',
        backup: {
          format: 'daidoko.local-backup',
          schemaVersion: 1,
          exportedAt: '2026-07-07T00:00:00.000Z',
          tables: emptyTables,
        },
        photos: [],
      }),
    );

    expect(manifest.recipePhotos).toEqual([]);
  });

  it('rejects recipe photo entries with bad owner type or path traversal', () => {
    const base = {
      format: 'daidoko.migration-backup',
      schemaVersion: 1,
      exportedAt: '2026-07-07T00:00:00.000Z',
      backup: {
        format: 'daidoko.local-backup',
        schemaVersion: 1,
        exportedAt: '2026-07-07T00:00:00.000Z',
        tables: emptyTables,
      },
      photos: [],
    };
    const entry = {
      ownerId: 'recipe-1',
      fileName: 'c.jpg',
      originalLocalPath: 'file:///old/c.jpg',
    };

    expect(() =>
      parseMigrationBackupManifest(
        JSON.stringify({
          ...base,
          recipePhotos: [{ ...entry, ownerType: 'banner', archivePath: 'recipe-photos/c.jpg' }],
        }),
      ),
    ).toThrow('レシピ写真バックアップの種別が不正です');

    expect(() =>
      parseMigrationBackupManifest(
        JSON.stringify({
          ...base,
          recipePhotos: [
            { ...entry, ownerType: 'recipe-cover', archivePath: 'recipe-photos/../../c.jpg' },
          ],
        }),
      ),
    ).toThrow('レシピ写真バックアップのパスが不正です');
  });

  it('decides auto snapshot from the latest backup age (modifiedAt = epoch seconds)', () => {
    const nowMs = new Date('2026-07-07T00:00:00Z').getTime();
    const backup = (ageDays: number): BackupFileSummary => ({
      uri: `file:///backups/${ageDays}.json`,
      fileName: `daidoko-backup-20260101-00000${ageDays}.json`,
      exportedAt: null,
      sizeBytes: 1,
      modifiedAt: nowMs / 1000 - ageDays * 86400,
    });

    expect(shouldCreateAutoSnapshot([], nowMs, 7)).toBe(true);
    expect(shouldCreateAutoSnapshot([backup(1)], nowMs, 7)).toBe(false);
    expect(shouldCreateAutoSnapshot([backup(8)], nowMs, 7)).toBe(true);
    // 新しいものが1件でもあれば作らない
    expect(shouldCreateAutoSnapshot([backup(8), backup(1)], nowMs, 7)).toBe(false);
  });

  it('selects only the oldest backups beyond the keep count for pruning', () => {
    const files: BackupFileSummary[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      uri: `file:///backups/${n}.json`,
      fileName: `daidoko-backup-2026010${n}-000000.json`,
      exportedAt: null,
      sizeBytes: 1,
      modifiedAt: n * 1000,
    }));

    const pruned = selectBackupsToPrune(files, 5);
    expect(pruned.map((f) => f.modifiedAt)).toEqual([2000, 1000]);
    expect(selectBackupsToPrune(files.slice(0, 3), 5)).toEqual([]);
  });

  it('picks the most recently modified backup', () => {
    const backups: BackupFileSummary[] = [
      {
        uri: 'file:///backups/old.json',
        fileName: 'daidoko-backup-20260530-070000.json',
        exportedAt: null,
        sizeBytes: 1,
        modifiedAt: 100,
      },
      {
        uri: 'file:///backups/new.json',
        fileName: 'daidoko-backup-20260530-080000.json',
        exportedAt: null,
        sizeBytes: 1,
        modifiedAt: 200,
      },
    ];

    expect(pickLatestBackup(backups)?.uri).toBe('file:///backups/new.json');
  });
});
