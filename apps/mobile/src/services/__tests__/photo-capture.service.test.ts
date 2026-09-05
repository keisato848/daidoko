import {
  PhotoCaptureCancelledError,
  capturePhoto,
  capturePhotoSeries,
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

describe('capturePhotoSeries — 連続撮影ループ（共通実装はここ 1 箇所）', () => {
  /** n 回まで撮れて、その後キャンセル（null）を返すカメラ。 */
  function cameraShots(count: number): () => Promise<{ localPath: string } | null> {
    let taken = 0;
    return async () => {
      if (taken >= count) return null;
      taken += 1;
      return { localPath: `file:///tmp/shot-${taken}.jpg` };
    };
  }

  it('「続けて撮る」を選ぶ限り上限まで撮り、上限到達で確認なしに自動終了する', async () => {
    const confirmMore = jest.fn(async () => true);
    const photos = await capturePhotoSeries(
      'camera',
      adapter({ captureFromCamera: cameraShots(10) }),
      { maxCount: 3, confirmMore },
    );

    expect(photos.map((p) => p.localPath)).toEqual([
      'file:///tmp/shot-1.jpg',
      'file:///tmp/shot-2.jpg',
      'file:///tmp/shot-3.jpg',
    ]);
    // 3 枚目（上限）のあとには聞かない。残り枚数も正しく渡る
    expect(confirmMore.mock.calls).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it('「これで完了」で打ち切る（撮った分は返す）', async () => {
    const photos = await capturePhotoSeries(
      'camera',
      adapter({ captureFromCamera: cameraShots(10) }),
      { maxCount: 3, confirmMore: async () => false },
    );
    expect(photos).toHaveLength(1);
  });

  it('上限 1 のときは確認を出さず従来どおり 1 枚で終わる', async () => {
    const confirmMore = jest.fn(async () => true);
    const photos = await capturePhotoSeries(
      'camera',
      adapter({ captureFromCamera: cameraShots(10) }),
      { maxCount: 1, confirmMore },
    );
    expect(photos).toHaveLength(1);
    expect(confirmMore).not.toHaveBeenCalled();
  });

  it('1 枚目のキャンセルは空配列（呼び出し側がキャンセル扱いにする）', async () => {
    const photos = await capturePhotoSeries(
      'camera',
      adapter({ captureFromCamera: cameraShots(0) }),
      { maxCount: 3, confirmMore: async () => true },
    );
    expect(photos).toEqual([]);
  });

  it('2 枚目のキャンセルは撮った分を生かして打ち切る', async () => {
    const photos = await capturePhotoSeries(
      'camera',
      adapter({ captureFromCamera: cameraShots(1) }),
      { maxCount: 3, confirmMore: async () => true },
    );
    expect(photos).toHaveLength(1);
  });

  it('confirmMore 未指定は 1 枚で終える（黙って撮り続けない）', async () => {
    const photos = await capturePhotoSeries(
      'camera',
      adapter({ captureFromCamera: cameraShots(10) }),
      { maxCount: 3 },
    );
    expect(photos).toHaveLength(1);
  });

  it('ギャラリーは複数選択（pickManyFromGallery）へ委ね、上限を渡す', async () => {
    const seen: number[] = [];
    const photos = await capturePhotoSeries(
      'gallery',
      adapter({
        pickManyFromGallery: async (limit) => {
          seen.push(limit);
          return [{ localPath: 'file:///tmp/g1.jpg' }, { localPath: 'file:///tmp/g2.jpg' }];
        },
      }),
      { maxCount: 2, confirmMore: async () => true },
    );
    expect(seen).toEqual([2]);
    expect(photos).toHaveLength(2);
    expect(photos.every((p) => p.source === 'gallery')).toBe(true);
  });
});
