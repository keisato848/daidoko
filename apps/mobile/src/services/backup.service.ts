import * as FileSystem from 'expo-file-system';

import { getDb, getExpoDb, isNativePlatform } from '../db/client';
import { rebuildFts } from '../db/migrate';

const BACKUP_FORMAT = 'daidoko.local-backup';
const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_DIRECTORY_NAME = 'backups';

type SqlValue = string | number | null;
type BackupRow = Record<string, SqlValue>;

interface BackupTableDefinition {
  name: BackupTableName;
  columns: readonly string[];
}

const BACKUP_TABLES = [
  {
    name: 'users',
    columns: ['id', 'display_name', 'avatar_url', 'created_at', 'updated_at'],
  },
  {
    name: 'families',
    columns: ['id', 'name', 'invite_code', 'owner_id', 'created_at', 'updated_at'],
  },
  {
    name: 'family_members',
    columns: ['id', 'family_id', 'user_id', 'role', 'joined_at'],
  },
  {
    name: 'sources',
    columns: [
      'id',
      'type',
      'url',
      'ocr_raw_text',
      'site_name',
      'page_title',
      'thumbnail_url',
      'captured_at',
      'created_at',
    ],
  },
  {
    name: 'recipes',
    columns: [
      'id',
      'family_id',
      'title',
      'title_reading',
      'current_rev_id',
      'status',
      'created_by',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'recipe_revisions',
    columns: [
      'id',
      'recipe_id',
      'revision_number',
      'is_major',
      'servings',
      'cook_time_min',
      'prep_time_min',
      'description',
      'author_note',
      'source_id',
      'created_by',
      'created_at',
    ],
  },
  {
    name: 'ingredients',
    columns: ['id', 'revision_id', 'sort_order', 'group_label', 'name', 'amount', 'note'],
  },
  {
    name: 'steps',
    columns: ['id', 'revision_id', 'sort_order', 'body', 'timer_sec', 'photo_id'],
  },
  {
    name: 'tags',
    columns: ['id', 'family_id', 'name', 'color'],
  },
  {
    name: 'recipe_tags',
    columns: ['recipe_id', 'tag_id'],
  },
  {
    name: 'cooking_logs',
    columns: [
      'id',
      'family_id',
      'recipe_id',
      'revision_id',
      'cooked_by',
      'cooked_at',
      'servings',
      'rating',
      'memo',
      'created_at',
    ],
  },
  {
    name: 'cooking_photos',
    columns: ['id', 'log_id', 'local_path', 'cloud_url', 'sort_order', 'taken_at', 'created_at'],
  },
  {
    name: 'memos',
    columns: ['id', 'recipe_id', 'author_id', 'body', 'is_private', 'created_at', 'updated_at'],
  },
  {
    name: 'sync_meta',
    columns: ['entity_type', 'entity_id', 'vector_clock', 'deleted_at', 'last_synced_at'],
  },
  {
    name: 'app_meta',
    columns: ['key', 'value', 'updated_at'],
  },
] as const;

type BackupTableName = (typeof BACKUP_TABLES)[number]['name'];
type BackupTables = Record<BackupTableName, BackupRow[]>;

export interface LocalBackupPayload {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  tables: BackupTables;
}

export interface BackupFileSummary {
  uri: string;
  fileName: string;
  exportedAt: string | null;
  sizeBytes: number;
  modifiedAt: number;
}

export interface BackupOperationResult {
  uri: string;
  fileName: string;
  exportedAt: string;
  sizeBytes: number;
}

function assertNative(): void {
  if (!isNativePlatform) {
    throw new Error('バックアップ・復元はネイティブアプリでのみ利用できます');
  }
}

function getBackupDirectory(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('ファイル保存領域を取得できませんでした');
  }
  return `${FileSystem.documentDirectory}${BACKUP_DIRECTORY_NAME}/`;
}

async function ensureBackupDirectory(): Promise<string> {
  const directory = getBackupDirectory();
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

function formatDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatBackupFileName(date = new Date()): string {
  const year = date.getFullYear();
  const month = formatDatePart(date.getMonth() + 1);
  const day = formatDatePart(date.getDate());
  const hour = formatDatePart(date.getHours());
  const minute = formatDatePart(date.getMinutes());
  const second = formatDatePart(date.getSeconds());
  return `daidoko-backup-${year}${month}${day}-${hour}${minute}${second}.json`;
}

function parseExportedAtFromFileName(fileName: string): string | null {
  const matched = /^daidoko-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/.exec(
    fileName,
  );
  if (!matched) return null;
  const [, year, month, day, hour, minute, second] = matched;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function createEmptyBackupTables(): BackupTables {
  return {
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
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function tableColumnList(table: BackupTableDefinition): string {
  return table.columns.map(quoteIdentifier).join(', ');
}

function tablePlaceholders(table: BackupTableDefinition): string {
  return table.columns.map(() => '?').join(', ');
}

function isSqlValue(value: unknown): value is SqlValue {
  return value == null || typeof value === 'string' || typeof value === 'number';
}

function isBackupRow(value: unknown): value is BackupRow {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(isSqlValue);
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('バックアップ形式が不正です');
  }
  return parsed as Record<string, unknown>;
}

export function parseLocalBackupPayload(text: string): LocalBackupPayload {
  const parsed = parseJsonObject(text);
  if (parsed.format !== BACKUP_FORMAT || parsed.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error('対応していないバックアップ形式です');
  }
  if (typeof parsed.exportedAt !== 'string') {
    throw new Error('バックアップ日時が不正です');
  }
  const rawTables = parsed.tables;
  if (rawTables == null || typeof rawTables !== 'object' || Array.isArray(rawTables)) {
    throw new Error('バックアップテーブルが不正です');
  }

  const tables = createEmptyBackupTables();
  const tableRecord = rawTables as Record<string, unknown>;
  for (const table of BACKUP_TABLES) {
    const rows = tableRecord[table.name];
    if (!Array.isArray(rows) || !rows.every(isBackupRow)) {
      throw new Error(`${table.name} のバックアップ内容が不正です`);
    }
    tables[table.name] = rows;
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: parsed.exportedAt,
    tables,
  };
}

export function pickLatestBackup(files: BackupFileSummary[]): BackupFileSummary | null {
  if (files.length === 0) return null;
  return [...files].sort((a, b) => {
    const modifiedDiff = b.modifiedAt - a.modifiedAt;
    return modifiedDiff !== 0 ? modifiedDiff : b.fileName.localeCompare(a.fileName);
  })[0];
}

function createPayloadFromDatabase(): LocalBackupPayload {
  const expoDb = getExpoDb();
  const tables = createEmptyBackupTables();

  for (const table of BACKUP_TABLES) {
    tables[table.name] = expoDb.getAllSync<BackupRow>(
      `SELECT ${tableColumnList(table)} FROM ${quoteIdentifier(table.name)}`,
    );
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

async function fileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return info.exists && typeof info.size === 'number' ? info.size : 0;
}

export async function listLocalBackups(): Promise<BackupFileSummary[]> {
  assertNative();
  const directory = await ensureBackupDirectory();
  const files = await FileSystem.readDirectoryAsync(directory);
  const backupFiles = files.filter((fileName) =>
    /^daidoko-backup-\d{8}-\d{6}\.json$/.test(fileName),
  );

  const summaries = await Promise.all(
    backupFiles.map(async (fileName) => {
      const uri = `${directory}${fileName}`;
      const info = await FileSystem.getInfoAsync(uri, { size: true });
      return {
        uri,
        fileName,
        exportedAt: parseExportedAtFromFileName(fileName),
        sizeBytes: info.exists && typeof info.size === 'number' ? info.size : 0,
        modifiedAt:
          info.exists && typeof info.modificationTime === 'number' ? info.modificationTime : 0,
      };
    }),
  );

  return summaries.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function createLocalBackup(): Promise<BackupOperationResult> {
  assertNative();
  const directory = await ensureBackupDirectory();
  const payload = createPayloadFromDatabase();
  const fileName = formatBackupFileName(new Date(payload.exportedAt));
  const uri = `${directory}${fileName}`;

  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return {
    uri,
    fileName,
    exportedAt: payload.exportedAt,
    sizeBytes: await fileSize(uri),
  };
}

function replaceDatabase(payload: LocalBackupPayload): void {
  const expoDb = getExpoDb();

  expoDb.execSync('PRAGMA foreign_keys = OFF');
  expoDb.execSync('BEGIN TRANSACTION');
  try {
    for (const table of [...BACKUP_TABLES].reverse()) {
      expoDb.runSync(`DELETE FROM ${quoteIdentifier(table.name)}`);
    }

    for (const table of BACKUP_TABLES) {
      const sql = `INSERT INTO ${quoteIdentifier(table.name)} (${tableColumnList(table)}) VALUES (${tablePlaceholders(table)})`;
      for (const row of payload.tables[table.name]) {
        expoDb.runSync(
          sql,
          table.columns.map((column) => row[column] ?? null),
        );
      }
    }
    expoDb.execSync('COMMIT');
  } catch (error) {
    expoDb.execSync('ROLLBACK');
    throw error;
  } finally {
    expoDb.execSync('PRAGMA foreign_keys = ON');
  }
}

export async function restoreLocalBackup(uri: string): Promise<BackupOperationResult> {
  assertNative();
  const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
  const payload = parseLocalBackupPayload(raw);

  replaceDatabase(payload);
  await rebuildFts(getDb());

  const fileName = uri.split('/').pop() ?? 'backup.json';
  return {
    uri,
    fileName,
    exportedAt: payload.exportedAt,
    sizeBytes: await fileSize(uri),
  };
}

export async function restoreLatestLocalBackup(): Promise<BackupOperationResult> {
  const latest = pickLatestBackup(await listLocalBackups());
  if (!latest) {
    throw new Error('復元できるバックアップがありません');
  }
  return restoreLocalBackup(latest.uri);
}
