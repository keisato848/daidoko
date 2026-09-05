/**
 * PhotoCapture service — adapter boundary for camera/gallery image acquisition.
 */
import { t, tCount } from '../i18n';
import { markPhotoCaptureEnd, markPhotoCaptureStart } from './app-open-ad.service';
import { dialog } from './dialog.service';

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

export interface CapturePhotoSeriesOptions {
  /** この呼び出しで取り込める上限（画面の残り枠を渡す）。 */
  maxCount: number;
  /**
   * カメラで 1 枚撮れるたびに「続けて撮るか」を聞く。省略時は聞かずに 1 枚で終える。
   * 画面からは `confirmContinueCapture`（共通ダイアログ）を渡す。テストでは差し替える。
   */
  confirmMore?: (taken: number, remaining: number) => Promise<boolean>;
}

/**
 * 連続撮影（オーナー要望 2026-09-05）。**ループはここ 1 箇所** — 各画面は上限だけ渡す。
 *
 * カメラ（`launchCameraAsync`）は 1 回 1 枚しか撮れないので、撮影成功のたびに
 * 「続けて撮る（あと n 枚）/ これで完了」を挟んで上限までループする。
 * - 上限 1 の呼び出しは従来どおり**確認なし**で 1 枚
 * - 1 枚目のキャンセル → 空配列（呼び出し側はキャンセル扱い）
 * - 2 枚目以降のキャンセル → **撮った分は生かして**打ち切る
 * ギャラリーは system Photo Picker の複数選択（`capturePhotosFromGallery`）に委ねる。
 */
export async function capturePhotoSeries(
  source: PhotoCaptureSource,
  adapter: PhotoCaptureAdapter,
  options: CapturePhotoSeriesOptions,
): Promise<CapturedPhoto[]> {
  const maxCount = Math.max(1, Math.floor(options.maxCount));
  if (source === 'gallery') return capturePhotosFromGallery(adapter, maxCount);

  const photos: CapturedPhoto[] = [];
  while (photos.length < maxCount) {
    try {
      photos.push(await capturePhoto('camera', adapter));
    } catch (error) {
      if (error instanceof PhotoCaptureCancelledError) break;
      throw error;
    }
    if (photos.length >= maxCount) break;
    const wantsMore = options.confirmMore
      ? await options.confirmMore(photos.length, maxCount - photos.length)
      : false;
    if (!wantsMore) break;
  }
  return photos;
}

/**
 * 「続けて撮るか」の共通ダイアログ。`DialogHost` が居ないときは false（= これで完了）に
 * 倒れるので、確認が出せない状況でも撮影が終わらなくなることはない。
 */
export function confirmContinueCapture(taken: number, remaining: number): Promise<boolean> {
  return dialog.confirm({
    title: t('common.captureMore.title'),
    message: tCount('common.captureMore.message', remaining),
    confirmLabel: t('common.captureMore.more'),
    cancelLabel: t('common.captureMore.done'),
  });
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
