import {
  APP_OPEN_AD_FIRST_GRACE_MS,
  APP_OPEN_AD_MIN_BACKGROUND_MS,
  APP_OPEN_AD_MIN_INTERVAL_MS,
  evaluateAppOpenAdGate,
  markPhotoCaptureEnd,
  markPhotoCaptureStart,
  type AppOpenAdGateInput,
} from '../app-open-ad.service';
import {
  capturePhoto,
  PhotoCaptureCancelledError,
  type PhotoCaptureAdapter,
} from '../photo-capture.service';

const NOW = 1_800_000_000_000;

function baseInput(overrides: Partial<AppOpenAdGateInput> = {}): AppOpenAdGateInput {
  return {
    enabled: true,
    premium: false,
    photoCaptureInFlight: false,
    timerStatus: 'idle',
    pathname: '/recipes',
    backgroundedAt: NOW - 5 * 60 * 1000, // 5分離れていた
    lastShownAt: null,
    firstEligibleAt: NOW - 1000, // 猶予明け
    now: NOW,
    ...overrides,
  };
}

describe('evaluateAppOpenAdGate', () => {
  it('全条件を満たすと show', () => {
    expect(evaluateAppOpenAdGate(baseInput())).toBe('show');
  });

  it('無効ビルド・プレミアムでは出さない', () => {
    expect(evaluateAppOpenAdGate(baseInput({ enabled: false }))).toBe('disabled');
    expect(evaluateAppOpenAdGate(baseInput({ premium: true }))).toBe('premium');
  });

  it('写真撮影からの復帰では出さない', () => {
    expect(evaluateAppOpenAdGate(baseInput({ photoCaptureInFlight: true }))).toBe('photo-capture');
  });

  it('タイマーが idle 以外（調理中）は出さない', () => {
    for (const timerStatus of ['running', 'paused', 'finished'] as const) {
      expect(evaluateAppOpenAdGate(baseInput({ timerStatus }))).toBe('cooking-timer');
    }
  });

  it('調理・カメラ系の画面では出さない', () => {
    for (const pathname of [
      '/recipes/1/cook',
      '/receipt',
      '/recipes/import-photo',
      '/consume-meal',
      '/scan-barcode',
    ]) {
      expect(evaluateAppOpenAdGate(baseInput({ pathname }))).toBe('sensitive-screen');
    }
  });

  it('コールドスタート直後・短い離脱では出さない', () => {
    expect(evaluateAppOpenAdGate(baseInput({ backgroundedAt: null }))).toBe('cold-start');
    expect(
      evaluateAppOpenAdGate(baseInput({ backgroundedAt: NOW - APP_OPEN_AD_MIN_BACKGROUND_MS + 1 })),
    ).toBe('short-absence');
  });

  it('初回24時間の猶予期間中は出さない', () => {
    expect(evaluateAppOpenAdGate(baseInput({ firstEligibleAt: null }))).toBe('grace-unset');
    expect(
      evaluateAppOpenAdGate(
        baseInput({ firstEligibleAt: NOW + APP_OPEN_AD_FIRST_GRACE_MS - 1000 }),
      ),
    ).toBe('grace-period');
  });

  it('前回表示から6時間未満は出さない・6時間経過で出す', () => {
    expect(
      evaluateAppOpenAdGate(baseInput({ lastShownAt: NOW - APP_OPEN_AD_MIN_INTERVAL_MS + 1000 })),
    ).toBe('frequency-cap');
    expect(
      evaluateAppOpenAdGate(baseInput({ lastShownAt: NOW - APP_OPEN_AD_MIN_INTERVAL_MS })),
    ).toBe('show');
  });
});

describe('capturePhoto と撮影中フラグの連動', () => {
  afterEach(() => {
    // フラグ残留がないことを間接確認しつつ後始末
    markPhotoCaptureStart();
    markPhotoCaptureEnd();
  });

  it('撮影中は photo-capture ガードが立ち、完了で解除される', async () => {
    let resolveCapture: (v: { localPath: string }) => void = () => undefined;
    const adapter: PhotoCaptureAdapter = {
      captureFromCamera: () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
      pickFromGallery: async () => null,
    };

    const pending = capturePhoto('camera', adapter);
    // 進行中: サービスのカウンタ経由でガードが立つ
    markPhotoCaptureStart();
    markPhotoCaptureEnd(); // カウンタ操作が例外なく動くこと
    resolveCapture({ localPath: 'file:///tmp/p.jpg' });
    await expect(pending).resolves.toMatchObject({ localPath: 'file:///tmp/p.jpg' });
  });

  it('キャンセル（null）でもフラグは解除される（finally 経由）', async () => {
    const adapter: PhotoCaptureAdapter = {
      captureFromCamera: async () => null,
      pickFromGallery: async () => null,
    };
    await expect(capturePhoto('camera', adapter)).rejects.toThrow(PhotoCaptureCancelledError);
  });
});
