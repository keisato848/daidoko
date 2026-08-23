/**
 * PhotoCapture service — adapter boundary for camera/gallery image acquisition.
 */
import { markPhotoCaptureEnd, markPhotoCaptureStart } from './app-open-ad.service';

export type PhotoCaptureSource = 'camera' | 'gallery';

export interface CapturedPhoto {
  localPath: string;
  source: PhotoCaptureSource;
  width?: number;
  height?: number;
  mimeType?: string;
  takenAt: string;
  temporary: boolean;
}

export interface PhotoCaptureAdapter {
  captureFromCamera: () => Promise<Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'> | null>;
  pickFromGallery: () => Promise<Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'> | null>;
  /**
   * ギャラリーから**複数枚**選ぶ。紙面は表と裏で 1 つのレシピになるので、
   * 1 枚ずつ選ばせると往復が増える。持たないアダプタでは 1 枚選択に落ちる。
   */
  pickManyFromGallery?: (
    limit: number,
  ) => Promise<Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'>[]>;
  deleteTemporaryFile?: (localPath: string) => Promise<void>;
  now?: () => string;
}

export class PhotoCaptureCancelledError extends Error {
  constructor() {
    super('Photo capture was cancelled');
    this.name = 'PhotoCaptureCancelledError';
  }
}

/**
 * **利用者に見せてよい**（翻訳済みの）エラー。
 *
 * 画面はこの型のときだけ `message` をそのまま出す。ネイティブモジュールが投げた例外は
 * 英語の Java スタックそのままなので、素通しさせない — 実際に写真取り込みで
 * Expo の Java 例外が画面に出た（2026-08-19・再実行で成功した間欠的な失敗）。
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

function stampPhoto(
  photo: Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'>,
  source: PhotoCaptureSource,
  now: () => string,
): CapturedPhoto {
  return {
    ...photo,
    source,
    takenAt: now(),
    temporary: true,
  };
}

export async function capturePhoto(
  source: PhotoCaptureSource,
  adapter: PhotoCaptureAdapter,
): Promise<CapturedPhoto> {
  const now = adapter.now ?? (() => new Date().toISOString());
  // カメラ/ギャラリー往復はアプリが一度 background になるため、復帰時の
  // アプリ起動広告を抑止するフラグを立てる（app-open-ad.service）。
  markPhotoCaptureStart();
  let photo: Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'> | null;
  try {
    photo =
      source === 'camera' ? await adapter.captureFromCamera() : await adapter.pickFromGallery();
  } finally {
    markPhotoCaptureEnd();
  }
  if (!photo) throw new PhotoCaptureCancelledError();
  return stampPhoto(photo, source, now);
}

/**
 * ギャラリーから複数枚まとめて取る。**キャンセルは空配列**（例外にしない）。
 * カメラは 1 回 1 枚しか撮れないので、複数枚は `capturePhoto('camera')` の繰り返しで作る。
 */
export async function capturePhotosFromGallery(
  adapter: PhotoCaptureAdapter,
  limit: number,
): Promise<CapturedPhoto[]> {
  const now = adapter.now ?? (() => new Date().toISOString());
  markPhotoCaptureStart();
  try {
    if (!adapter.pickManyFromGallery) {
      const single = await adapter.pickFromGallery();
      return single ? [stampPhoto(single, 'gallery', now)] : [];
    }
    const picked = await adapter.pickManyFromGallery(limit);
    return picked.slice(0, limit).map((photo) => stampPhoto(photo, 'gallery', now));
  } finally {
    markPhotoCaptureEnd();
  }
}

export async function cleanupTemporaryPhotos(
  photos: Pick<CapturedPhoto, 'localPath' | 'temporary'>[],
  adapter: Pick<PhotoCaptureAdapter, 'deleteTemporaryFile'>,
): Promise<void> {
  if (!adapter.deleteTemporaryFile) return;
  await Promise.all(
    photos
      .filter((photo) => photo.temporary)
      .map((photo) => adapter.deleteTemporaryFile?.(photo.localPath)),
  );
}
