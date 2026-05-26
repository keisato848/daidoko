/**
 * PhotoCapture service — adapter boundary for camera/gallery image acquisition.
 */
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
  deleteTemporaryFile?: (localPath: string) => Promise<void>;
  now?: () => string;
}

export class PhotoCaptureCancelledError extends Error {
  constructor() {
    super('Photo capture was cancelled');
    this.name = 'PhotoCaptureCancelledError';
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
  const photo =
    source === 'camera' ? await adapter.captureFromCamera() : await adapter.pickFromGallery();
  if (!photo) throw new PhotoCaptureCancelledError();
  return stampPhoto(photo, source, now);
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
