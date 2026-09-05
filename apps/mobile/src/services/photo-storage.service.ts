import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { resolvePhotoUri, toStoredPhotoPath } from './photo-path';
import { AI_GENERATED_PHOTO_PREFIX } from '../utils/aiGeneratedPhoto';
import { generateId } from '../utils/id';
import type { CapturedPhoto } from './photo-capture.service';
import type { SaveCookingPhotoInput } from './types';
import { t, tCount } from '../i18n';

export const MAX_COOKING_LOG_PHOTOS = 6;
/** 保存写真の長辺上限（px）。これ以上は縮小してから保存する。 */
export const PHOTO_MAX_DIMENSION = 1600;
/** 保存時の JPEG 品質。 */
export const PHOTO_JPEG_QUALITY = 0.8;

interface FileStorageAdapter {
  documentDirectory: string | null;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean }>;
  makeDirectoryAsync: (uri: string, options: { intermediates: boolean }) => Promise<void>;
  copyAsync: (options: { from: string; to: string }) => Promise<void>;
  deleteAsync: (uri: string, options: { idempotent: boolean }) => Promise<void>;
}

const expoFileStorageAdapter: FileStorageAdapter = {
  get documentDirectory() {
    return FileSystem.documentDirectory;
  },
  getInfoAsync: FileSystem.getInfoAsync,
  makeDirectoryAsync: FileSystem.makeDirectoryAsync,
  copyAsync: FileSystem.copyAsync,
  deleteAsync: FileSystem.deleteAsync,
};

// ─── 保存時圧縮 ──────────────────────────────────────────────────────────────
// 原寸のカメラ写真（2〜5MB）をそのまま貯めると端末容量を圧迫するため、
// 保存前に長辺 PHOTO_MAX_DIMENSION へ縮小し JPEG 再エンコードする（約1/10）。

export interface PhotoCompressAdapter {
  /** 縮小＋JPEG化した一時ファイルの uri を返す。失敗時は throw してよい。 */
  compress: (
    uri: string,
    options: { maxDimension: number; quality: number },
  ) => Promise<{ uri: string }>;
}

const expoPhotoCompressAdapter: PhotoCompressAdapter = {
  async compress(uri, { maxDimension, quality }) {
    const context = ImageManipulator.manipulate(uri);
    const original = await context.renderAsync();
    if (Math.max(original.width, original.height) > maxDimension) {
      context.resize(
        original.width >= original.height ? { width: maxDimension } : { height: maxDimension },
      );
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality });
    return { uri: saved.uri };
  },
};

/**
 * Compress a captured photo for storage. Returns the compressed temp file (as
 * JPEG) or null when compression is unavailable — callers then store the
 * original file untouched.
 */
async function compressForStorage(
  uri: string,
  compressAdapter: PhotoCompressAdapter,
): Promise<string | null> {
  try {
    const result = await compressAdapter.compress(uri, {
      maxDimension: PHOTO_MAX_DIMENSION,
      quality: PHOTO_JPEG_QUALITY,
    });
    return result.uri;
  } catch {
    return null; // 圧縮できない環境・形式では原本をそのまま保存
  }
}

function getPhotoDirectory(adapter: FileStorageAdapter): string {
  if (!adapter.documentDirectory) {
    throw new Error(t('error.photoStorageUnavailable'));
  }
  return `${adapter.documentDirectory}cooking-photos/`;
}

async function ensurePhotoDirectory(adapter: FileStorageAdapter): Promise<string> {
  const directory = getPhotoDirectory(adapter);
  const info = await adapter.getInfoAsync(directory);
  if (!info.exists) {
    await adapter.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

export function extensionForPhoto(uri: string, mimeType?: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'image/heif') return 'heif';

  const path = uri.split(/[?#]/)[0];
  const matched = /\.([A-Za-z0-9]+)$/.exec(path);
  const extension = matched?.[1]?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : 'jpg';
}

export function createCookingPhotoFileName(
  takenAt: string,
  extension: string,
  id = generateId(),
): string {
  const timestamp = takenAt.replace(/[^0-9]/g, '').slice(0, 14) || String(Date.now());
  return `cooking-photo-${timestamp}-${id}.${extension}`;
}

async function persistCookingLogPhoto(
  photo: CapturedPhoto,
  adapter: FileStorageAdapter,
  compressAdapter: PhotoCompressAdapter,
): Promise<SaveCookingPhotoInput> {
  const directory = await ensurePhotoDirectory(adapter);
  const compressed = await compressForStorage(photo.localPath, compressAdapter);
  const source = compressed ?? photo.localPath;
  const extension = compressed ? 'jpg' : extensionForPhoto(photo.localPath, photo.mimeType);
  const fileName = createCookingPhotoFileName(photo.takenAt, extension);
  const destination = `${directory}${fileName}`;

  await adapter.copyAsync({ from: source, to: destination });
  return {
    // DB には相対パスで持つ（iOS の container UUID は更新で変わる — photo-path.ts）
    localPath: toStoredPhotoPath(destination),
    takenAt: photo.takenAt,
  };
}

export async function persistCookingLogPhotos(
  photos: CapturedPhoto[],
  adapter: FileStorageAdapter = expoFileStorageAdapter,
  compressAdapter: PhotoCompressAdapter = expoPhotoCompressAdapter,
): Promise<SaveCookingPhotoInput[]> {
  if (photos.length > MAX_COOKING_LOG_PHOTOS) {
    throw new RangeError(tCount('log.form.photoLimit', MAX_COOKING_LOG_PHOTOS));
  }

  const persisted: SaveCookingPhotoInput[] = [];
  for (const photo of photos) {
    persisted.push(await persistCookingLogPhoto(photo, adapter, compressAdapter));
  }
  return persisted;
}

export async function cleanupStoredCookingPhotos(
  photos: SaveCookingPhotoInput[],
  adapter: FileStorageAdapter = expoFileStorageAdapter,
): Promise<void> {
  await Promise.all(
    // 保存値は相対パス（旧データは絶対）。実ファイルに触るので必ず解決してから
    photos.map((photo) =>
      adapter.deleteAsync(resolvePhotoUri(photo.localPath), { idempotent: true }),
    ),
  );
}

// ─── Recipe photos (表紙・手順写真) ──────────────────────────────────────────

function getRecipePhotoDirectory(adapter: FileStorageAdapter): string {
  if (!adapter.documentDirectory) {
    throw new Error(t('error.photoStorageUnavailable'));
  }
  return `${adapter.documentDirectory}recipe-photos/`;
}

export function createRecipePhotoFileName(
  takenAt: string,
  extension: string,
  id = generateId(),
): string {
  const timestamp = takenAt.replace(/[^0-9]/g, '').slice(0, 14) || String(Date.now());
  return `recipe-photo-${timestamp}-${id}.${extension}`;
}

export interface PersistRecipePhotoOptions {
  /**
   * ファイル名の接頭辞（例: `'aigen-'`）。AI が作ったイメージだと
   * `isAiGeneratedPhoto()` が判定できるようにするための唯一の運び手
   * （docs/レシピ表紙AI生成設計.md §4 — 端末内・バックアップ・将来の同期はこれで運ぶ）。
   * 省略時は接頭辞なし（従来どおり）。
   */
  filenamePrefix?: string;
}

/**
 * Copy a captured photo into the app's recipe-photos directory (used for the
 * recipe cover and per-step photos), compressed for storage.
 * Returns the persisted local path.
 */
export async function persistRecipePhoto(
  photo: CapturedPhoto,
  adapter: FileStorageAdapter = expoFileStorageAdapter,
  compressAdapter: PhotoCompressAdapter = expoPhotoCompressAdapter,
  options: PersistRecipePhotoOptions = {},
): Promise<string> {
  const directory = getRecipePhotoDirectory(adapter);
  const info = await adapter.getInfoAsync(directory);
  if (!info.exists) {
    await adapter.makeDirectoryAsync(directory, { intermediates: true });
  }
  const compressed = await compressForStorage(photo.localPath, compressAdapter);
  const source = compressed ?? photo.localPath;
  const extension = compressed ? 'jpg' : extensionForPhoto(photo.localPath, photo.mimeType);
  const fileName = `${options.filenamePrefix ?? ''}${createRecipePhotoFileName(photo.takenAt, extension)}`;
  const destination = `${directory}${fileName}`;
  await adapter.copyAsync({ from: source, to: destination });
  return toStoredPhotoPath(destination);
}

// ─── AI が生成したイメージ（cover-image.provider の応答）を保存する ──────────
// docs/レシピ表紙AI生成設計.md §2/§4。生成結果は base64 バイト列で届くだけで、
// `CapturedPhoto` のようにローカルファイルではないため、まずキャッシュへ書き出してから
// **既存の `persistRecipePhoto` に filenamePrefix 付きで通す**（圧縮パイプライン・
// 保存先ディレクトリを他の表紙写真と共有する — 別経路を増やさない）。

interface GeneratedImageCacheAdapter {
  cacheDirectory: string | null;
  writeAsStringAsync: (
    uri: string,
    content: string,
    options: { encoding: 'base64' },
  ) => Promise<void>;
}

const expoGeneratedImageCacheAdapter: GeneratedImageCacheAdapter = {
  get cacheDirectory() {
    return FileSystem.cacheDirectory;
  },
  writeAsStringAsync: (uri, content, options) =>
    FileSystem.writeAsStringAsync(uri, content, {
      encoding:
        options.encoding === 'base64'
          ? FileSystem.EncodingType.Base64
          : FileSystem.EncodingType.UTF8,
    }),
};

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * AI が生成した画像（base64）を、他の表紙写真と同じ保存先へ `aigen-` 接頭辞つきで
 * 永続化する。ファイル名の接頭辞だけが「AI 生成」の唯一の運び手
 * （`utils/aiGeneratedPhoto.ts` の `isAiGeneratedPhoto()` が見る）。
 */
export async function persistGeneratedCoverImage(
  result: { mimeType: string; dataBase64: string },
  cacheAdapter: GeneratedImageCacheAdapter = expoGeneratedImageCacheAdapter,
  adapter: FileStorageAdapter = expoFileStorageAdapter,
  compressAdapter: PhotoCompressAdapter = expoPhotoCompressAdapter,
): Promise<string> {
  if (!cacheAdapter.cacheDirectory) {
    throw new Error(t('error.photoStorageUnavailable'));
  }
  const tempUri = `${cacheAdapter.cacheDirectory}cover-image-${generateId()}.${extensionForMime(result.mimeType)}`;
  await cacheAdapter.writeAsStringAsync(tempUri, result.dataBase64, { encoding: 'base64' });
  const photo: CapturedPhoto = {
    localPath: tempUri,
    source: 'gallery',
    mimeType: result.mimeType,
    takenAt: new Date().toISOString(),
    temporary: true,
  };
  return persistRecipePhoto(photo, adapter, compressAdapter, {
    filenamePrefix: AI_GENERATED_PHOTO_PREFIX,
  });
}
