import {
  PhotoCaptureCancelledError,
  capturePhoto,
  cleanupTemporaryPhotos,
  type PhotoCaptureAdapter,
} from '../photo-capture.service';

function adapter(overrides: Partial<PhotoCaptureAdapter> = {}): PhotoCaptureAdapter {
  return {
    now: () => '2026-05-27T10:00:00.000Z',
    captureFromCamera: async () => ({
      localPath: 'file:///tmp/camera.jpg',
      width: 1200,
      height: 900,
    }),
    pickFromGallery: async () => ({
      localPath: 'file:///tmp/gallery.jpg',
      width: 1000,
      height: 800,
    }),
    ...overrides,
  };
}

describe('OCR-REQ-01 photo capture boundary', () => {
  it('captures a camera photo with source metadata', async () => {
    const photo = await capturePhoto('camera', adapter());

    expect(photo).toMatchObject({
      localPath: 'file:///tmp/camera.jpg',
      source: 'camera',
      takenAt: '2026-05-27T10:00:00.000Z',
      temporary: true,
    });
  });

  it('picks a gallery photo with source metadata', async () => {
    const photo = await capturePhoto('gallery', adapter());

    expect(photo).toMatchObject({
      localPath: 'file:///tmp/gallery.jpg',
      source: 'gallery',
      temporary: true,
    });
  });

  it('returns a typed cancellation error when adapter returns null', async () => {
    await expect(
      capturePhoto('camera', adapter({ captureFromCamera: async () => null })),
    ).rejects.toBeInstanceOf(PhotoCaptureCancelledError);
  });

  it('cleans up only temporary photos', async () => {
    const deleted: string[] = [];

    await cleanupTemporaryPhotos(
      [
        { localPath: 'file:///tmp/a.jpg', temporary: true },
        { localPath: 'file:///tmp/b.jpg', temporary: false },
      ],
      { deleteTemporaryFile: async (localPath) => void deleted.push(localPath) },
    );

    expect(deleted).toEqual(['file:///tmp/a.jpg']);
  });
});
