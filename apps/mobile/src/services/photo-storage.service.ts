import * as FileSystem from 'expo-file-system';

import { generateId } from '../utils/id';
import type { CapturedPhoto } from './photo-capture.service';
import type { SaveCookingPhotoInput } from './types';

export const MAX_COOKING_LOG_PHOTOS = 6;

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

function getPhotoDirectory(adapter: FileStorageAdapter): string {
  if (!adapter.documentDirectory) {
    throw new Error('写真の保存先を取得できませんでした');
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
): Promise<SaveCookingPhotoInput> {
  const directory = await ensurePhotoDirectory(adapter);
  const extension = extensionForPhoto(photo.localPath, photo.mimeType);
  const fileName = createCookingPhotoFileName(photo.takenAt, extension);
  const destination = `${directory}${fileName}`;

  await adapter.copyAsync({ from: photo.localPath, to: destination });
  return {
    localPath: destination,
    takenAt: photo.takenAt,
  };
}

export async function persistCookingLogPhotos(
  photos: CapturedPhoto[],
  adapter: FileStorageAdapter = expoFileStorageAdapter,
): Promise<SaveCookingPhotoInput[]> {
  if (photos.length > MAX_COOKING_LOG_PHOTOS) {
    throw new RangeError(`写真は${MAX_COOKING_LOG_PHOTOS}枚まで追加できます`);
  }

  const persisted: SaveCookingPhotoInput[] = [];
  for (const photo of photos) {
    persisted.push(await persistCookingLogPhoto(photo, adapter));
  }
  return persisted;
}

export async function cleanupStoredCookingPhotos(
  photos: SaveCookingPhotoInput[],
  adapter: FileStorageAdapter = expoFileStorageAdapter,
): Promise<void> {
  await Promise.all(
    photos.map((photo) => adapter.deleteAsync(photo.localPath, { idempotent: true })),
  );
}
