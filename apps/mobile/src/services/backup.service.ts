import * as FileSystem from 'expo-file-system/legacy';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { Platform } from 'react-native';

import { getDb, getExpoDb, isNativePlatform } from '../db/client';
import { rebuildFts } from '../db/migrate';
import { getAppMeta, setAppMeta } from './app-meta.service';

const BACKUP_FORMAT = 'daidoko.local-backup';
const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_DIRECTORY_NAME = 'backups';
const MIGRATION_BACKUP_FORMAT = 'daidoko.migration-backup';
// v1 のまま recipePhotos を「省略可のフィールド」として拡張している（旧アプリは
// 未知フィールドを無視して DB＋調理写真だけ復元できる後方/前方互換のため、bump しない）
const MIGRATION_BACKUP_SCHEMA_VERSION = 1;
const MIGRATION_MANIFEST_FILE_NAME = 'manifest.json';
const MIGRATION_PHOTO_DIRECTORY_NAME = 'cooking-photos';
const MIGRATION_RECIPE_PHOTO_DIRECTORY_NAME = 'recipe-photos';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// 外部退避（共有 / SAF 書き出し）を最後に実行した日時と、SAF 保存先の永続化キー
const LAST_EXTERNAL_EXPORT_KEY = 'backup_last_external_export_at';
const SAF_DIRECTORY_KEY = 'backup_saf_directory_uri';

/** 自動スナップショットの間隔と保持世代数（起動時に maybeCreateAutoSnapshot が使用） */
export const AUTO_SNAPSHOT_INTERVAL_DAYS = 7;
export const AUTO_SNAPSHOT_KEEP = 5;

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
      'cover_photo_path',
      'pinned_at',
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
    columns: ['id', 'revision_id', 'sort_order', 'body', 'timer_sec', 'photo_id', 'photo_path'],
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

export interface MigrationPhotoManifestEntry {
  id: string;
  archivePath: string;
  fileName: string;
  originalLocalPath: string;
}

export type MigrationRecipePhotoOwner = 'recipe-cover' | 'step';

/** レシピの表紙・手順写真の同梱エントリ（v1 拡張・旧アプリは無視できる） */
export interface MigrationRecipePhotoManifestEntry {
  ownerType: MigrationRecipePhotoOwner;
  /** recipes.id（recipe-cover）または steps.id（step） */
  ownerId: string;
  archivePath: string;
  fileName: string;
  originalLocalPath: string;
}

export interface MigrationBackupManifest {
  format: typeof MIGRATION_BACKUP_FORMAT;
  schemaVersion: typeof MIGRATION_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  backup: LocalBackupPayload;
  photos: MigrationPhotoManifestEntry[];
  /** 省略可（旧形式 ZIP には無い）: レシピ表紙・手順写真 */
  recipePhotos?: MigrationRecipePhotoManifestEntry[];
}

export interface MigrationBackupOperationResult extends BackupOperationResult {
  photoCount: number;
}

export interface MigrationBackupRestoreResult extends BackupOperationResult {
  restoredPhotoCount: number;
  missingPhotoCount: number;
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

export function formatMigrationBackupFileName(date = new Date()): string {
  const year = date.getFullYear();
  const month = formatDatePart(date.getMonth() + 1);
  const day = formatDatePart(date.getDate());
  const hour = formatDatePart(date.getHours());
  const minute = formatDatePart(date.getMinutes());
  const second = formatDatePart(date.getSeconds());
  return `daidoko-transfer-${year}${month}${day}-${hour}${minute}${second}.daidoko.zip`;
}

function parseExportedAtFromFileName(fileName: string): string | null {
  const matched = /^daidoko-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/.exec(
    fileName,
  );
  if (!matched) return null;
  const [, year, month, day, hour, minute, second] = matched;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function parseExportedAtFromMigrationFileName(fileName: string): string | null {
  const matched =
    /^daidoko-transfer-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.daidoko\.zip$/.exec(fileName);
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

function parseLocalBackupPayloadObject(parsed: Record<string, unknown>): LocalBackupPayload {
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

export function parseLocalBackupPayload(text: string): LocalBackupPayload {
  return parseLocalBackupPayloadObject(parseJsonObject(text));
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

function parseMigrationPhotoEntry(value: unknown): MigrationPhotoManifestEntry {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('写真バックアップ情報が不正です');
  }
  const entry = value as Record<string, unknown>;
  const archivePath = assertString(entry.archivePath, '写真バックアップのパスが不正です');
  if (
    !archivePath.startsWith(`${MIGRATION_PHOTO_DIRECTORY_NAME}/`) ||
    archivePath.includes('..') ||
    archivePath.includes('\\')
  ) {
    throw new Error('写真バックアップのパスが不正です');
  }

  return {
    id: assertString(entry.id, '写真バックアップのIDが不正です'),
    archivePath,
    fileName: assertString(entry.fileName, '写真バックアップのファイル名が不正です'),
    originalLocalPath: assertString(entry.originalLocalPath, '写真バックアップの元パスが不正です'),
  };
}

function parseMigrationRecipePhotoEntry(value: unknown): MigrationRecipePhotoManifestEntry {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('レシピ写真バックアップ情報が不正です');
  }
  const entry = value as Record<string, unknown>;
  const ownerType = entry.ownerType;
  if (ownerType !== 'recipe-cover' && ownerType !== 'step') {
    throw new Error('レシピ写真バックアップの種別が不正です');
  }
  const archivePath = assertString(entry.archivePath, 'レシピ写真バックアップのパスが不正です');
  if (
    !archivePath.startsWith(`${MIGRATION_RECIPE_PHOTO_DIRECTORY_NAME}/`) ||
    archivePath.includes('..') ||
    archivePath.includes('\\')
  ) {
    throw new Error('レシピ写真バックアップのパスが不正です');
  }

  return {
    ownerType,
    ownerId: assertString(entry.ownerId, 'レシピ写真バックアップのIDが不正です'),
    archivePath,
    fileName: assertString(entry.fileName, 'レシピ写真バックアップのファイル名が不正です'),
    originalLocalPath: assertString(
      entry.originalLocalPath,
      'レシピ写真バックアップの元パスが不正です',
    ),
  };
}

export function parseMigrationBackupManifest(text: string): MigrationBackupManifest {
  const parsed = parseJsonObject(text);
  if (
    parsed.format !== MIGRATION_BACKUP_FORMAT ||
    parsed.schemaVersion !== MIGRATION_BACKUP_SCHEMA_VERSION
  ) {
    throw new Error('対応していない移行バックアップ形式です');
  }
  const exportedAt = assertString(parsed.exportedAt, '移行バックアップ日時が不正です');
  const rawBackup = parsed.backup;
  if (rawBackup == null || typeof rawBackup !== 'object' || Array.isArray(rawBackup)) {
    throw new Error('移行バックアップのデータが不正です');
  }
  const rawPhotos = parsed.photos;
  if (!Array.isArray(rawPhotos)) {
    throw new Error('写真バックアップ一覧が不正です');
  }
  // recipePhotos は省略可（旧形式 ZIP との互換）
  const rawRecipePhotos = parsed.recipePhotos;
  if (rawRecipePhotos != null && !Array.isArray(rawRecipePhotos)) {
    throw new Error('レシピ写真バックアップ一覧が不正です');
  }

  return {
    format: MIGRATION_BACKUP_FORMAT,
    schemaVersion: MIGRATION_BACKUP_SCHEMA_VERSION,
    exportedAt,
    backup: parseLocalBackupPayloadObject(rawBackup as Record<string, unknown>),
    photos: rawPhotos.map(parseMigrationPhotoEntry),
    recipePhotos: (rawRecipePhotos ?? []).map(parseMigrationRecipePhotoEntry),
  };
}

export function pickLatestBackup(files: BackupFileSummary[]): BackupFileSummary | null {
  if (files.length === 0) return null;
  return [...files].sort((a, b) => {
    const modifiedDiff = b.modifiedAt - a.modifiedAt;
    return modifiedDiff !== 0 ? modifiedDiff : b.fileName.localeCompare(a.fileName);
  })[0];
}

function base64CharToValue(character: string): number {
  const value = BASE64_ALPHABET.indexOf(character);
  if (value < 0) {
    throw new Error('Base64 データが不正です');
  }
  return value;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.replace(/\s/g, '');
  if (normalized.length === 0) return new Uint8Array();
  if (normalized.length % 4 === 1) {
    throw new Error('Base64 データが不正です');
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(Math.floor((normalized.length * 3) / 4) - padding);
  let outputIndex = 0;

  for (let inputIndex = 0; inputIndex < normalized.length; inputIndex += 4) {
    const first = base64CharToValue(normalized[inputIndex]);
    const second = base64CharToValue(normalized[inputIndex + 1]);
    const thirdChar = normalized[inputIndex + 2];
    const fourthChar = normalized[inputIndex + 3];
    const third = thirdChar === '=' || thirdChar == null ? 0 : base64CharToValue(thirdChar);
    const fourth = fourthChar === '=' || fourthChar == null ? 0 : base64CharToValue(fourthChar);
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;

    if (outputIndex < bytes.length) bytes[outputIndex++] = (combined >> 16) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = (combined >> 8) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = combined & 0xff;
  }

  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 3) {
    const first = bytes[byteIndex];
    const second = bytes[byteIndex + 1];
    const third = bytes[byteIndex + 2];
    const hasSecond = byteIndex + 1 < bytes.length;
    const hasThird = byteIndex + 2 < bytes.length;
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    chunks.push(
      BASE64_ALPHABET[(combined >> 18) & 0x3f],
      BASE64_ALPHABET[(combined >> 12) & 0x3f],
      hasSecond ? BASE64_ALPHABET[(combined >> 6) & 0x3f] : '=',
      hasThird ? BASE64_ALPHABET[combined & 0x3f] : '=',
    );
  }
  return chunks.join('');
}

function sanitizeArchiveFileName(value: string): string {
  return value
    .replace(/[\\/]/g, '-')
    .replace(/[<>:"|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function fileNameFromUri(uri: string, fallback: string): string {
  const path = uri.split(/[?#]/)[0];
  const rawName = path.split('/').filter(Boolean).pop() ?? fallback;
  const sanitized = sanitizeArchiveFileName(rawName);
  return sanitized || fallback;
}

export function createMigrationPhotoArchivePath(photoId: string, localPath: string): string {
  const safeId = sanitizeArchiveFileName(photoId) || 'photo';
  const fileName = fileNameFromUri(localPath, `${safeId}.jpg`);
  return `${MIGRATION_PHOTO_DIRECTORY_NAME}/${safeId}-${fileName}`;
}

export function createMigrationRecipePhotoArchivePath(
  ownerType: MigrationRecipePhotoOwner,
  ownerId: string,
  localPath: string,
): string {
  const prefix = ownerType === 'recipe-cover' ? 'cover' : 'step';
  const safeId = sanitizeArchiveFileName(ownerId) || 'photo';
  const fileName = fileNameFromUri(localPath, `${safeId}.jpg`);
  return `${MIGRATION_RECIPE_PHOTO_DIRECTORY_NAME}/${prefix}-${safeId}-${fileName}`;
}

function getRequiredDocumentDirectory(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('ファイル保存領域を取得できませんでした');
  }
  return FileSystem.documentDirectory;
}

async function ensureCookingPhotoDirectory(): Promise<string> {
  const directory = `${getRequiredDocumentDirectory()}${MIGRATION_PHOTO_DIRECTORY_NAME}/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

async function ensureRecipePhotoDirectory(): Promise<string> {
  const directory = `${getRequiredDocumentDirectory()}${MIGRATION_RECIPE_PHOTO_DIRECTORY_NAME}/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

function rowString(row: BackupRow, column: string): string | null {
  const value = row[column];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function updatePhotoLocalPath(
  payload: LocalBackupPayload,
  photoId: string,
  localPath: string | null,
): void {
  const row = payload.tables.cooking_photos.find((photo) => photo.id === photoId);
  if (row) {
    row.local_path = localPath;
  }
}

function clearPhotoLocalPaths(payload: LocalBackupPayload): void {
  for (const row of payload.tables.cooking_photos) {
    row.local_path = null;
  }
}

/** 復元先端末に存在しないパスを持ち込まないよう、表紙・手順写真のパスも一旦クリアする
 *（ZIP に同梱されている分だけ updateRecipePhotoPath で復元される。旧形式 ZIP では
 *  同梱が無いため null のまま = ダングリングパス残留バグの修正でもある） */
function clearRecipePhotoPaths(payload: LocalBackupPayload): void {
  for (const row of payload.tables.recipes) {
    row.cover_photo_path = null;
  }
  for (const row of payload.tables.steps) {
    row.photo_path = null;
  }
}

function updateRecipePhotoPath(
  payload: LocalBackupPayload,
  entry: MigrationRecipePhotoManifestEntry,
  localPath: string | null,
): void {
  const rows = entry.ownerType === 'recipe-cover' ? payload.tables.recipes : payload.tables.steps;
  const column = entry.ownerType === 'recipe-cover' ? 'cover_photo_path' : 'photo_path';
  const row = rows.find((candidate) => candidate.id === entry.ownerId);
  if (row) {
    row[column] = localPath;
  }
}

function cloneBackupPayload(payload: LocalBackupPayload): LocalBackupPayload {
  return parseLocalBackupPayload(JSON.stringify(payload));
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
  const info = await FileSystem.getInfoAsync(uri);
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
      const info = await FileSystem.getInfoAsync(uri);
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

export async function listMigrationBackupPackages(): Promise<BackupFileSummary[]> {
  assertNative();
  const directory = await ensureBackupDirectory();
  const files = await FileSystem.readDirectoryAsync(directory);
  const backupFiles = files.filter((fileName) =>
    /^daidoko-transfer-\d{8}-\d{6}\.daidoko\.zip$/.test(fileName),
  );

  const summaries = await Promise.all(
    backupFiles.map(async (fileName) => {
      const uri = `${directory}${fileName}`;
      const info = await FileSystem.getInfoAsync(uri);
      return {
        uri,
        fileName,
        exportedAt: parseExportedAtFromMigrationFileName(fileName),
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

export async function createMigrationBackupPackage(): Promise<MigrationBackupOperationResult> {
  assertNative();
  const directory = await ensureBackupDirectory();
  const payload = createPayloadFromDatabase();
  const zipEntries: Record<string, Uint8Array> = {};
  const photos: MigrationPhotoManifestEntry[] = [];
  const recipePhotos: MigrationRecipePhotoManifestEntry[] = [];

  for (const row of payload.tables.cooking_photos) {
    const photoId = rowString(row, 'id');
    const localPath = rowString(row, 'local_path');
    if (!photoId || !localPath) continue;

    const info = await FileSystem.getInfoAsync(localPath);
    if (!info.exists) {
      updatePhotoLocalPath(payload, photoId, null);
      continue;
    }

    const archivePath = createMigrationPhotoArchivePath(photoId, localPath);
    const fileName = archivePath.split('/').pop() ?? `${photoId}.jpg`;
    const photoBase64 = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    zipEntries[archivePath] = base64ToUint8Array(photoBase64);
    photos.push({ id: photoId, archivePath, fileName, originalLocalPath: localPath });
  }

  // レシピの表紙写真・手順写真も同梱する（欠損ファイルはパスをクリアして持ち込まない）
  const bundleRecipePhoto = async (
    ownerType: MigrationRecipePhotoOwner,
    row: BackupRow,
    column: 'cover_photo_path' | 'photo_path',
  ): Promise<void> => {
    const ownerId = rowString(row, 'id');
    const localPath = rowString(row, column);
    if (!ownerId || !localPath) return;

    const info = await FileSystem.getInfoAsync(localPath);
    if (!info.exists) {
      row[column] = null;
      return;
    }

    const archivePath = createMigrationRecipePhotoArchivePath(ownerType, ownerId, localPath);
    const fileName = archivePath.split('/').pop() ?? `${ownerId}.jpg`;
    const photoBase64 = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    zipEntries[archivePath] = base64ToUint8Array(photoBase64);
    recipePhotos.push({ ownerType, ownerId, archivePath, fileName, originalLocalPath: localPath });
  };
  for (const row of payload.tables.recipes) {
    await bundleRecipePhoto('recipe-cover', row, 'cover_photo_path');
  }
  for (const row of payload.tables.steps) {
    await bundleRecipePhoto('step', row, 'photo_path');
  }

  const manifest: MigrationBackupManifest = {
    format: MIGRATION_BACKUP_FORMAT,
    schemaVersion: MIGRATION_BACKUP_SCHEMA_VERSION,
    exportedAt: payload.exportedAt,
    backup: payload,
    photos,
    recipePhotos,
  };
  zipEntries[MIGRATION_MANIFEST_FILE_NAME] = strToU8(JSON.stringify(manifest, null, 2));

  const zipBytes = zipSync(zipEntries, { level: 6 });
  const fileName = formatMigrationBackupFileName(new Date(payload.exportedAt));
  const uri = `${directory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, uint8ArrayToBase64(zipBytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    uri,
    fileName,
    exportedAt: payload.exportedAt,
    sizeBytes: await fileSize(uri),
    photoCount: photos.length + recipePhotos.length,
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

export async function restoreMigrationBackupPackage(
  uri: string,
): Promise<MigrationBackupRestoreResult> {
  assertNative();
  const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const entries = unzipSync(base64ToUint8Array(raw));
  const manifestEntry = entries[MIGRATION_MANIFEST_FILE_NAME];
  if (!manifestEntry) {
    throw new Error('移行バックアップの manifest が見つかりません');
  }

  const manifest = parseMigrationBackupManifest(strFromU8(manifestEntry));
  const payload = cloneBackupPayload(manifest.backup);
  clearPhotoLocalPaths(payload);
  clearRecipePhotoPaths(payload);
  const photoDirectory = await ensureCookingPhotoDirectory();
  const recipePhotoDirectory = await ensureRecipePhotoDirectory();
  const recipePhotos = manifest.recipePhotos ?? [];
  const copiedPhotoUris: string[] = [];
  let restoredPhotoCount = 0;

  try {
    for (const photo of manifest.photos) {
      const photoEntry = entries[photo.archivePath];
      if (!photoEntry) {
        updatePhotoLocalPath(payload, photo.id, null);
        continue;
      }

      const destinationFileName = fileNameFromUri(photo.fileName, `${photo.id}.jpg`);
      const destination = `${photoDirectory}${destinationFileName}`;
      await FileSystem.writeAsStringAsync(destination, uint8ArrayToBase64(photoEntry), {
        encoding: FileSystem.EncodingType.Base64,
      });
      copiedPhotoUris.push(destination);
      updatePhotoLocalPath(payload, photo.id, destination);
      restoredPhotoCount += 1;
    }

    for (const photo of recipePhotos) {
      const photoEntry = entries[photo.archivePath];
      if (!photoEntry) continue; // clearRecipePhotoPaths 済みなので null のまま

      const destinationFileName = fileNameFromUri(
        photo.archivePath.split('/').pop() ?? photo.fileName,
        `${photo.ownerId}.jpg`,
      );
      const destination = `${recipePhotoDirectory}${destinationFileName}`;
      await FileSystem.writeAsStringAsync(destination, uint8ArrayToBase64(photoEntry), {
        encoding: FileSystem.EncodingType.Base64,
      });
      copiedPhotoUris.push(destination);
      updateRecipePhotoPath(payload, photo, destination);
      restoredPhotoCount += 1;
    }

    replaceDatabase(payload);
    await rebuildFts(getDb());
  } catch (error) {
    await Promise.all(
      copiedPhotoUris.map((photoUri) => FileSystem.deleteAsync(photoUri, { idempotent: true })),
    );
    throw error;
  }

  const fileName = uri.split('/').pop() ?? 'migration-backup.daidoko.zip';
  return {
    uri,
    fileName,
    exportedAt: manifest.exportedAt,
    sizeBytes: await fileSize(uri),
    restoredPhotoCount,
    missingPhotoCount: manifest.photos.length + recipePhotos.length - restoredPhotoCount,
  };
}

export async function restoreLatestLocalBackup(): Promise<BackupOperationResult> {
  const latest = pickLatestBackup(await listLocalBackups());
  if (!latest) {
    throw new Error('復元できるバックアップがありません');
  }
  return restoreLocalBackup(latest.uri);
}

// ─── 自動スナップショット（起動時） ─────────────────────────────────────────────

/** 自動スナップショットを作るべきか（最新が interval 日より古い or 1件も無い）。
 *  modifiedAt は expo-file-system の modificationTime（エポック秒）。 */
export function shouldCreateAutoSnapshot(
  backups: BackupFileSummary[],
  nowMs: number,
  intervalDays: number = AUTO_SNAPSHOT_INTERVAL_DAYS,
): boolean {
  const latest = pickLatestBackup(backups);
  if (!latest) return true;
  return nowMs / 1000 - latest.modifiedAt >= intervalDays * 86400;
}

/** 保持世代数を超えた古いバックアップ（末尾 = 古い順）を返す。 */
export function selectBackupsToPrune(
  backups: BackupFileSummary[],
  keep: number = AUTO_SNAPSHOT_KEEP,
): BackupFileSummary[] {
  return [...backups]
    .sort((a, b) => b.modifiedAt - a.modifiedAt || b.fileName.localeCompare(a.fileName))
    .slice(keep);
}

/**
 * 起動時に呼ぶ: 最新スナップショットが古ければサイレントに作成し、世代を間引く。
 * SAF の保存先（Google ドライブ等）が設定済みなら外部へも書き出す。
 * 何か失敗しても起動をブロックしない（呼び出し側で catch）。
 */
export async function maybeCreateAutoSnapshot(
  now = new Date(),
): Promise<BackupOperationResult | null> {
  if (!isNativePlatform) return null;
  const backups = await listLocalBackups();
  if (!shouldCreateAutoSnapshot(backups, now.getTime())) return null;

  const result = await createLocalBackup();

  for (const stale of selectBackupsToPrune(await listLocalBackups())) {
    await FileSystem.deleteAsync(stale.uri, { idempotent: true });
  }

  // 外部退避先が設定済みなら自動でコピー（失敗しても致命ではない — 次回の督促表示で気づける）
  try {
    await exportFileToSafDirectory(result.uri, result.fileName, 'application/json');
  } catch {
    // 権限失効など — バックアップ画面で再選択してもらう
  }

  return result;
}

// ─── 外部退避（共有 / SAF）────────────────────────────────────────────────────

/** 最後に外部退避（共有 or SAF 書き出し）した日時を記録する。 */
export async function markBackupExported(now = new Date()): Promise<void> {
  await setAppMeta(LAST_EXTERNAL_EXPORT_KEY, now.toISOString());
}

/** 最後の外部退避日時（ISO）。未実施なら null。 */
export async function getLastBackupExportAt(): Promise<string | null> {
  const value = await getAppMeta(LAST_EXTERNAL_EXPORT_KEY);
  return value && value.length > 0 ? value : null;
}

/** SAF の保存先ディレクトリ URI（Android のみ・未設定なら null）。 */
export async function getSafBackupDirectory(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const value = await getAppMeta(SAF_DIRECTORY_KEY);
  return value && value.length > 0 ? value : null;
}

/**
 * システムのフォルダピッカーで保存先を選ぶ（Google ドライブもプロバイダとして選べる）。
 * 権限は永続化され、以後の自動書き出しに使う。キャンセル時は null。
 */
export async function chooseSafBackupDirectory(): Promise<string | null> {
  if (!isNativePlatform || Platform.OS !== 'android') return null;
  const result = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!result.granted) return null;
  await setAppMeta(SAF_DIRECTORY_KEY, result.directoryUri);
  return result.directoryUri;
}

export async function clearSafBackupDirectory(): Promise<void> {
  await setAppMeta(SAF_DIRECTORY_KEY, '');
}

/**
 * 設定済みの SAF 保存先へファイルをコピーする。書き出せたら外部退避日時も更新。
 * 保存先未設定なら false。権限失効などの失敗は例外を投げる（呼び出し側で案内）。
 */
export async function exportFileToSafDirectory(
  sourceUri: string,
  fileName: string,
  mimeType: string,
): Promise<boolean> {
  const directoryUri = await getSafBackupDirectory();
  if (!directoryUri) return false;

  const destination = await FileSystem.StorageAccessFramework.createFileAsync(
    directoryUri,
    fileName,
    mimeType,
  );
  const content = await FileSystem.readAsStringAsync(sourceUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await FileSystem.writeAsStringAsync(destination, content, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await markBackupExported();
  return true;
}
