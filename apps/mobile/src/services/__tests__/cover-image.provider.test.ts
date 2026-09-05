/**
 * レシピ「イメージ」の AI 生成（R4・クライアント側 provider）。
 * docs/レシピ表紙AI生成設計.md。
 *
 * ここで固定するのは:
 * - managed サーバー経路が x-device-id を必ず送ること
 * - BYOK 経路は Interactions API を x-goog-api-key で直接叩き、サーバーを経由しないこと
 * - 404/未デプロイ・タイムアウト（AbortError）を例外を握って CoverImageError にすること
 *   （[client-must-survive-server-skew]）
 * - 成功時に mimeType/dataBase64 をそのまま返すこと
 */
const mockGetUserApiKey = jest.fn<Promise<string | null>, []>();
jest.mock('../byok.service', () => ({ getUserApiKey: () => mockGetUserApiKey() }));

const mockGetInstallationId = jest.fn<Promise<string>, []>();
jest.mock('../app-meta.service', () => ({ getInstallationId: () => mockGetInstallationId() }));

import {
  buildCoverImagePrompt,
  CLIENT_TIMEOUT_MS,
  CoverImageError,
  generateCoverImage,
  type CoverImageInput,
} from '../cover-image.provider';

const INPUT: CoverImageInput = {
  title: '麻婆豆腐',
  ingredientNames: ['木綿豆腐', '豚ひき肉'],
  tags: ['中華'],
};

describe('buildCoverImagePrompt', () => {
  it('タイトル・材料・タグを含む', () => {
    const prompt = buildCoverImagePrompt(INPUT, 'ja');
    expect(prompt).toContain('麻婆豆腐');
    expect(prompt).toContain('木綿豆腐');
    expect(prompt).toContain('中華');
  });

  it('材料/タグが空でも壊れない', () => {
    const prompt = buildCoverImagePrompt({ title: '味噌汁', ingredientNames: [], tags: [] }, 'ja');
    expect(prompt).toContain('味噌汁');
  });
});

describe('generateCoverImage — managed サーバー経由', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    mockGetUserApiKey.mockReset().mockResolvedValue(null);
    mockGetInstallationId.mockReset().mockResolvedValue('device-abc-123');
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, data: { mimeType: 'image/jpeg', dataBase64: 'ZmFrZQ==' } }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function lastHeaders(): Record<string, string> {
    return (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
  }

  function lastUrl(): string {
    return fetchMock.mock.calls[0][0] as string;
  }

  it('x-device-id を必ず送る', async () => {
    await generateCoverImage(INPUT);
    expect(lastHeaders()['x-device-id']).toBe('device-abc-123');
  });

  it('/infer/cover-image を叩く', async () => {
    await generateCoverImage(INPUT);
    expect(lastUrl()).toContain('/infer/cover-image');
  });

  it('成功時に mimeType/dataBase64 をそのまま返す', async () => {
    const result = await generateCoverImage(INPUT);
    expect(result).toEqual({ mimeType: 'image/jpeg', dataBase64: 'ZmFrZQ==' });
  });

  it('/infer/cover-image 未デプロイの 404 も例外を握って CoverImageError にする', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(generateCoverImage(INPUT)).rejects.toBeInstanceOf(CoverImageError);
  });

  it('AI_QUOTA_EXCEEDED は retryable:false で失敗する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: { code: 'AI_QUOTA_EXCEEDED', message: 'x', retryable: false },
      }),
    });
    await expect(generateCoverImage(INPUT)).rejects.toMatchObject({ retryable: false });
  });

  it('provider 失敗（COVER_IMAGE_FAILED）は retryable:true で失敗する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: { code: 'COVER_IMAGE_FAILED', message: 'x', retryable: true },
      }),
    });
    await expect(generateCoverImage(INPUT)).rejects.toMatchObject({ retryable: true });
  });

  it('タイムアウト（AbortError）を握って CoverImageError にする', async () => {
    fetchMock.mockImplementation(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    await expect(generateCoverImage(INPUT)).rejects.toBeInstanceOf(CoverImageError);
  });

  it('クライアントタイムアウトは 75 秒（サーバー 55 秒予算の外側 — 設計 §5）', () => {
    expect(CLIENT_TIMEOUT_MS).toBe(75_000);
  });
});

describe('generateCoverImage — BYOK（自分のキーで直接）', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    mockGetUserApiKey.mockReset().mockResolvedValue('user-key');
    mockGetInstallationId.mockReset().mockResolvedValue('device-abc-123');
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        steps: [
          { type: 'thought', signature: 'x'.repeat(500) },
          {
            type: 'model_output',
            content: [{ type: 'image', data: 'ZmFrZQ==', mime_type: 'image/jpeg' }],
          },
        ],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('サーバーを経由せず Interactions API を直接叩く（device-id 不要）', async () => {
    const result = await generateCoverImage(INPUT);
    expect(result).toEqual({ mimeType: 'image/jpeg', dataBase64: 'ZmFrZQ==' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('generativelanguage.googleapis.com/v1beta/interactions');
    expect(mockGetInstallationId).not.toHaveBeenCalled();
  });

  it('x-goog-api-key ヘッダで自分のキーを渡す（?key= クエリではない）', async () => {
    await generateCoverImage(INPUT);
    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers['x-goog-api-key']).toBe('user-key');
  });

  it('429 は BYOK 側の枠切れとして扱う', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'quota' });
    await expect(generateCoverImage(INPUT)).rejects.toBeInstanceOf(CoverImageError);
  });

  it('画像が返らないレスポンスは失敗として扱う', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(generateCoverImage(INPUT)).rejects.toBeInstanceOf(CoverImageError);
  });

  it('thought だけで model_output が無い応答は失敗として扱う（thought を画像と誤認しない）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        steps: [{ type: 'thought', signature: 'x'.repeat(500) }],
      }),
    });
    await expect(generateCoverImage(INPUT)).rejects.toBeInstanceOf(CoverImageError);
  });
});
