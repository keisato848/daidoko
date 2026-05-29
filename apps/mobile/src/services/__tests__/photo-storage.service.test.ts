import {
  createCookingPhotoFileName,
  extensionForPhoto,
  MAX_COOKING_LOG_PHOTOS,
  persistCookingLogPhotos,
} from '../photo-storage.service';
import type { CapturedPhoto } from '../photo-capture.service';

describe('photo-storage.service', () => {
  it('chooses an extension from mime type before uri', () => {
    expect(extensionForPhoto('file:///tmp/photo.jpeg', 'image/png')).toBe('png');
    expect(extensionForPhoto('file:///tmp/photo', undefined)).toBe('jpg');
    expect(extensionForPhoto('file:///tmp/photo.webp?x=1', undefined)).toBe('webp');
  });

  it('creates stable cooking photo file names', () => {
    expect(createCookingPhotoFileName('2026-05-30T01:02:03.000Z', 'jpg', 'abc123')).toBe(
      'cooking-photo-20260530010203-abc123.jpg',
    );
  });

  it('copies selected photos into the app document area', async () => {
    const copied: { from: string; to: string }[] = [];
    const adapter = {
      documentDirectory: 'file:///documents/',
      getInfoAsync: jest.fn(async () => ({ exists: false })),
      makeDirectoryAsync: jest.fn(async () => undefined),
      copyAsync: jest.fn(async (options: { from: string; to: string }) => {
        copied.push(options);
      }),
      deleteAsync: jest.fn(async () => undefined),
    };
    const photo: CapturedPhoto = {
      localPath: 'file:///cache/dinner.jpg',
      source: 'gallery',
      mimeType: 'image/jpeg',
      takenAt: '2026-05-30T01:02:03.000Z',
      temporary: true,
    };

    const result = await persistCookingLogPhotos([photo], adapter);

    expect(adapter.makeDirectoryAsync).toHaveBeenCalledWith('file:///documents/cooking-photos/', {
      intermediates: true,
    });
    expect(copied[0].from).toBe('file:///cache/dinner.jpg');
    expect(result[0].localPath).toContain('file:///documents/cooking-photos/cooking-photo-');
  });

  it('rejects more than the maximum supported photos', async () => {
    const photos = Array.from({ length: MAX_COOKING_LOG_PHOTOS + 1 }, (_, index) => ({
      localPath: `file:///cache/${index}.jpg`,
      source: 'gallery' as const,
      takenAt: '2026-05-30T01:02:03.000Z',
      temporary: true,
    }));

    await expect(persistCookingLogPhotos(photos)).rejects.toThrow('写真は6枚まで追加できます');
  });
});
