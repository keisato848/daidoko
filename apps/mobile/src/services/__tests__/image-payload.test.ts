/**
 * 画像送信の共通入口（水平展開規約①）。ここで固定するのは 3 点:
 * - 送信前に**必ず**縮小が呼ばれ、縮小後の URI が base64 化されること
 * - 縮小後は mimeType が image/jpeg に揃うこと
 * - 縮小が失敗しても止めない（元画像・元 mimeType で続ける）こと
 */
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: async (path: string) => `B64:${path}`,
  EncodingType: { Base64: 'base64' },
}));

const mockPreprocess = jest.fn<Promise<{ imageUri: string }>, [string]>();
jest.mock('../image-preprocess.service', () => ({
  preprocessImageForOcr: (uri: string) => mockPreprocess(uri),
}));
jest.mock('../expo-image-preprocess.adapter', () => ({
  expoImageManipulatorPreprocessAdapter: {},
}));

import { mimeTypeForUri, toInferImagePayload } from '../image-payload';

beforeEach(() => {
  mockPreprocess.mockImplementation(async (uri) => ({ imageUri: `processed:${uri}` }));
});

afterEach(() => jest.clearAllMocks());

describe('toInferImagePayload', () => {
  it('縮小が呼ばれ、縮小後の URI を base64 化して返す（mimeType は JPEG に揃う）', async () => {
    const payload = await toInferImagePayload({
      localPath: 'file:///a.png',
      mimeType: 'image/png',
    });
    expect(mockPreprocess).toHaveBeenCalledWith('file:///a.png');
    expect(payload).toEqual({ imageBase64: 'B64:processed:file:///a.png', mimeType: 'image/jpeg' });
  });

  it('縮小が失敗しても止めない — 元画像・元 mimeType のまま送る', async () => {
    mockPreprocess.mockRejectedValue(new Error('manipulator crashed'));
    const payload = await toInferImagePayload({
      localPath: 'file:///a.webp',
      mimeType: 'image/webp',
    });
    expect(payload).toEqual({ imageBase64: 'B64:file:///a.webp', mimeType: 'image/webp' });
  });

  it('mimeType 省略時は拡張子から推定する', async () => {
    mockPreprocess.mockRejectedValue(new Error('skip'));
    const payload = await toInferImagePayload({ localPath: 'file:///photo.PNG' });
    expect(payload.mimeType).toBe('image/png');
  });
});

describe('mimeTypeForUri', () => {
  it.each([
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.webp', 'image/webp'],
    ['a.unknown', 'image/jpeg'],
  ] as const)('%s → %s', (uri, mime) => {
    expect(mimeTypeForUri(uri)).toBe(mime);
  });
});
