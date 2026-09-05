/**
 * 冷蔵庫写真の読み取り — クライアント側。
 *
 * ここで固定するのは 2 点:
 * - `sanitizeFridgeItems`（サーバー側の写し）のケース表
 * - BYOK / managed サーバーの分岐（BYOK は Gemini へ直接・managed は
 *   **`x-device-id` を必ず送る**）と、無料枠エラーの変換
 */
const mockGetUserApiKey = jest.fn<Promise<string | null>, []>();
jest.mock('../byok.service', () => ({ getUserApiKey: () => mockGetUserApiKey() }));

const mockGetInstallationId = jest.fn<Promise<string>, []>();
jest.mock('../app-meta.service', () => ({ getInstallationId: () => mockGetInstallationId() }));

const mockResolveQuotaSource = jest.fn<Promise<'token' | 'premium' | undefined>, []>();
jest.mock('../usage.service', () => ({ resolveQuotaSource: () => mockResolveQuotaSource() }));

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: async () => 'BASE64BYTES',
  EncodingType: { Base64: 'base64' },
}));

import { FridgeInferError, inferFridgeItems, sanitizeFridgeItems } from '../fridge-vision.provider';

describe('sanitizeFridgeItems — サーバー側の写し（捨てる方向のみ・埋めない）', () => {
  it('品名なし・空文字は捨て、50 字に切り詰める', () => {
    const items = sanitizeFridgeItems({
      items: [
        { confidence: 0.9 },
        { name: '  ', confidence: 0.9 },
        { name: 'あ'.repeat(80), confidence: 0.9 },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].name).toHaveLength(50);
  });

  it('confidence は 0〜1 に丸め、数値でなければ 0（要確認側へ倒す）', () => {
    const items = sanitizeFridgeItems({
      items: [
        { name: '牛乳', confidence: 1.4 },
        { name: '卵', confidence: -1 },
        { name: '味噌', confidence: 'high' },
      ],
    });
    expect(items).toEqual([
      { name: '牛乳', confidence: 1 },
      { name: '卵', confidence: 0 },
      { name: '味噌', confidence: 0 },
    ]);
  });

  it('同名（全半角・カナ/かな・空白の差を無視）は confidence が高い方を残す', () => {
    const items = sanitizeFridgeItems({
      items: [
        { name: 'とうふ', confidence: 0.4 },
        { name: 'ﾄｳﾌ', confidence: 0.9 },
      ],
    });
    expect(items).toEqual([{ name: 'ﾄｳﾌ', confidence: 0.9 }]);
  });

  it('上限（60 品）を超えたぶんは捨てる', () => {
    const raw = {
      items: Array.from({ length: 70 }, (_, i) => ({ name: `品目${i}`, confidence: 0.5 })),
    };
    expect(sanitizeFridgeItems(raw)).toHaveLength(60);
  });

  it('raw が null/undefined でも落ちない（空扱い）', () => {
    expect(sanitizeFridgeItems(null)).toEqual([]);
    expect(sanitizeFridgeItems(undefined)).toEqual([]);
  });
});

describe('inferFridgeItems — BYOK / managed サーバーの分岐', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetUserApiKey.mockResolvedValue(null);
    mockGetInstallationId.mockResolvedValue('device-test-0001');
    mockResolveQuotaSource.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function serverOk(items: unknown) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { items } }),
    };
  }

  it('BYOK キーが無ければサーバーへ。x-device-id を必ず送り、source は cloud', async () => {
    fetchMock.mockResolvedValue(serverOk([{ name: '牛乳', confidence: 0.9 }]));

    const result = await inferFridgeItems({
      images: [{ localPath: 'file:///fridge.jpg', mimeType: 'image/jpeg' }],
    });

    expect(result.source).toBe('cloud');
    expect(result.items).toEqual([{ name: '牛乳', confidence: 0.9 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/infer/fridge');
    expect((init.headers as Record<string, string>)['x-device-id']).toBe('device-test-0001');
    expect(init.headers as Record<string, string>).not.toHaveProperty('x-quota-source');
    const body = JSON.parse(String(init.body)) as { images: { imageBase64: string }[] };
    expect(body.images).toEqual([{ imageBase64: 'BASE64BYTES', mimeType: 'image/jpeg' }]);
  });

  it('トークン実行時は x-quota-source: token を付ける', async () => {
    mockResolveQuotaSource.mockResolvedValue('token');
    fetchMock.mockResolvedValue(serverOk([]));

    await inferFridgeItems({ images: [{ localPath: 'file:///a.jpg', mimeType: 'image/jpeg' }] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-quota-source']).toBe('token');
  });

  it('managed 応答にも防御的に検証を通す（重複・範囲外 confidence が直る）', async () => {
    fetchMock.mockResolvedValue(
      serverOk([
        { name: 'とうふ', confidence: 0.4 },
        { name: 'トウフ', confidence: 1.7 },
      ]),
    );
    const result = await inferFridgeItems({
      images: [{ localPath: 'file:///a.jpg', mimeType: 'image/jpeg' }],
    });
    expect(result.items).toEqual([{ name: 'トウフ', confidence: 1 }]);
  });

  it('無料枠切れ（FREE_QUOTA_EXCEEDED）は retryable=false の FridgeInferError', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: false,
        error: { code: 'FREE_QUOTA_EXCEEDED', message: 'quota', retryable: false },
      }),
    });

    await expect(
      inferFridgeItems({ images: [{ localPath: 'file:///a.jpg', mimeType: 'image/jpeg' }] }),
    ).rejects.toMatchObject({ name: 'FridgeInferError', retryable: false });
  });

  it('HTTP エラー（未デプロイの 404 など）は例外にして在庫に触らせない', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(
      inferFridgeItems({ images: [{ localPath: 'file:///a.jpg', mimeType: 'image/jpeg' }] }),
    ).rejects.toBeInstanceOf(FridgeInferError);
  });

  it('BYOK キーがあれば Gemini へ直接（source は byok・x-device-id は送らない）', async () => {
    mockGetUserApiKey.mockResolvedValue('user-key');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ items: [{ name: '卵', confidence: 0.8 }] }) }],
            },
          },
        ],
      }),
    });

    const result = await inferFridgeItems({
      images: [{ localPath: 'file:///a.jpg', mimeType: 'image/jpeg' }],
    });

    expect(result.source).toBe('byok');
    expect(result.items).toEqual([{ name: '卵', confidence: 0.8 }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('user-key');
    expect(init.headers as Record<string, string>).not.toHaveProperty('x-device-id');
  });

  it('画像は最大 2 枚に切り詰めて送る（契約 MAX_FRIDGE_IMAGES）', async () => {
    fetchMock.mockResolvedValue(serverOk([]));
    const image = { localPath: 'file:///a.jpg', mimeType: 'image/jpeg' } as const;
    await inferFridgeItems({ images: [image, image, image] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { images: unknown[] };
    expect(body.images).toHaveLength(2);
  });
});
