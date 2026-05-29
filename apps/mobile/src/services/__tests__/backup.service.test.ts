import {
  formatBackupFileName,
  parseLocalBackupPayload,
  pickLatestBackup,
  type BackupFileSummary,
} from '../backup.service';

describe('backup.service', () => {
  it('formats backup file names with local timestamp components', () => {
    const date = new Date(2026, 4, 30, 7, 8, 9);
    expect(formatBackupFileName(date)).toBe('daidoko-backup-20260530-070809.json');
  });

  it('parses a valid local backup payload', () => {
    const payload = parseLocalBackupPayload(
      JSON.stringify({
        format: 'daidoko.local-backup',
        schemaVersion: 1,
        exportedAt: '2026-05-30T00:00:00.000Z',
        tables: {
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
        },
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
