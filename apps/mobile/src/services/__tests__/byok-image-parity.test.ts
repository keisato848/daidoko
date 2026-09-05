/**
 * BYOK 経路の対称性（オーナー原則 2026-09-05: **BYOK は上限解除のみ** —
 * 機能・挙動・品質は通常経路と同一。`docs/フリーミアム設計.md` §9）。
 *
 * 画像送信の共通入口（image-payload.ts・規約①）が **BYOK 分岐でも**必ず通ることを
 * 固定する。サーバー経路だけ縮小して BYOK が原寸のままだと、
 * 「サーバー上限 8MB / Gemini 直 20MB」の差が「BYOK なら動く」という
 * 機能非対称に化ける — その芽をここで摘む。
 */
const mockGetUserApiKey = jest.fn<Promise<string | null>, []>();
jest.mock('../byok.service', () => ({ getUserApiKey: () => mockGetUserApiKey() }));

const mockToPayload = jest.fn<
  Promise<{ imageBase64: string; mimeType: string }>,
  [{ localPath: string; mimeType?: string }]
>();
jest.mock('../image-payload', () => ({
  toInferImagePayload: (image: { localPath: string; mimeType?: string }) => mockToPayload(image),
  mimeTypeForUri: () => 'image/jpeg',
}));

jest.mock('../app-meta.service', () => ({ getInstallationId: async () => 'device-test-0001' }));
jest.mock('../usage.service', () => ({ resolveQuotaSource: async () => undefined }));

import { inferFridgeItems } from '../fridge-vision.provider';
import { inferMealFromVision } from '../meal-vision.provider';
import { inferReceiptFromVision } from '../receipt-vision.provider';
import { encodePhotos } from '../recipe-refine.provider';

function geminiOk(payloadJson: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payloadJson) }] } }],
    }),
  };
}

describe('BYOK 分岐でも共通の縮小ヘルパーを通る（両経路同一）', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetUserApiKey.mockResolvedValue('user-key');
    mockToPayload.mockResolvedValue({ imageBase64: 'PROCESSED64', mimeType: 'image/jpeg' });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function sentInlineData(): string[] {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com'); // BYOK 直
    const body = JSON.parse(String(init.body)) as {
      contents: { parts: { inlineData?: { data: string } }[] }[];
    };
    return body.contents[0].parts
      .map((part) => part.inlineData?.data)
      .filter((data): data is string => data !== undefined);
  }

  it('冷蔵庫: 縮小済み payload が Gemini へ渡る', async () => {
    fetchMock.mockResolvedValue(geminiOk({ items: [] }));
    await inferFridgeItems({ images: [{ localPath: 'file:///a.jpg', mimeType: 'image/jpeg' }] });
    expect(mockToPayload).toHaveBeenCalled();
    expect(sentInlineData()).toEqual(['PROCESSED64']);
  });

  it('食事写真: 縮小済み payload が Gemini へ渡る', async () => {
    fetchMock.mockResolvedValue(geminiOk({ isMeal: true, ingredients: [] }));
    await inferMealFromVision({ localPath: 'file:///a.jpg', mimeType: 'image/jpeg' });
    expect(mockToPayload).toHaveBeenCalled();
    expect(sentInlineData()).toEqual(['PROCESSED64']);
  });

  it('レシート（画像経路）: 縮小済み payload が Gemini へ渡る', async () => {
    fetchMock.mockResolvedValue(geminiOk({ isReceipt: true, items: [] }));
    await inferReceiptFromVision({ localPath: 'file:///a.jpg', mimeType: 'image/jpeg' });
    expect(mockToPayload).toHaveBeenCalled();
    expect(sentInlineData()).toEqual(['PROCESSED64']);
  });

  it('感想調整: encodePhotos が分岐の前に共通ヘルパーを通す（BYOK/サーバー共通）', async () => {
    const encoded = await encodePhotos([
      { uri: 'file:///cooked.jpg', role: 'cooked' },
      { uri: 'file:///target.jpg', role: 'target' },
    ]);
    expect(mockToPayload).toHaveBeenCalledTimes(2);
    expect(encoded).toEqual([
      { imageBase64: 'PROCESSED64', mimeType: 'image/jpeg', role: 'cooked' },
      { imageBase64: 'PROCESSED64', mimeType: 'image/jpeg', role: 'target' },
    ]);
  });
});
