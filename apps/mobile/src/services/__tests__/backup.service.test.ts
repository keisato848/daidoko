import {
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
