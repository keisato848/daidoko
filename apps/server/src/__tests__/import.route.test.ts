/**
 * Integration tests for POST /api/v1/import/url
 * Uses vitest + Hono's test utilities (fetch is mocked, no real network calls)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../index.js';

// ─── fetch mock helpers ───────────────────────────────────────────────────────

const RECIPE_HTML = `<html><head>
<script type="application/ld+json">
{
  "@type": "Recipe",
  "name": "テスト料理",
  "recipeYield": "2人分",
  "cookTime": "PT15M",
  "recipeIngredient": ["卵 2個", "塩 少々"],
  "recipeInstructions": [
    { "@type": "HowToStep", "text": "卵を割る" },
    { "@type": "HowToStep", "text": "焼く" }
  ]
}
</script>
</head><body></body></html>`;

const NO_JSON_LD_HTML = `<html><body><p>レシピなし</p></body></html>`;

function mockFetchOk(html: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    }),
  );
}

function mockFetchFail(status = 404) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: async () => '',
    }),
  );
}

function mockFetchNetworkError() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/import/url', () => {
  describe('バリデーション', () => {
    it('URLがなければ 400 を返す', async () => {
      const res = await app.request('/api/v1/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('不正な URL 形式では 400 を返す', async () => {
      const res = await app.request('/api/v1/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-url' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('成功ケース', () => {
    beforeEach(() => {
      mockFetchOk(RECIPE_HTML);
    });

    it('有効な URL + JSON-LD → ok:true, RecipeDraft を返す', async () => {
      const res = await app.request('/api/v1/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/recipe' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data?: { title: string } };
      expect(body.ok).toBe(true);
      expect(body.data?.title).toBe('テスト料理');
    });

    it('RecipeDraft に正しい材料数が含まれる', async () => {
      const res = await app.request('/api/v1/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/recipe' }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        data?: { ingredients: unknown[] };
      };
      expect(body.data?.ingredients).toHaveLength(2);
    });
  });

  describe('エラーケース', () => {
    it('JSON-LD なし → ok:false, UNSUPPORTED_SITE', async () => {
      mockFetchOk(NO_JSON_LD_HTML);
      const res = await app.request('/api/v1/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://unsupported.example.com' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('UNSUPPORTED_SITE');
    });

    it('HTTP 404 → ok:false, FETCH_FAILED', async () => {
      mockFetchFail(404);
      const res = await app.request('/api/v1/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/notfound' }),
      });
      const body = (await res.json()) as { ok: boolean; error?: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('FETCH_FAILED');
    });

    it('ネットワークエラー → ok:false, FETCH_FAILED', async () => {
      mockFetchNetworkError();
      const res = await app.request('/api/v1/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });
      const body = (await res.json()) as { ok: boolean; error?: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('FETCH_FAILED');
    });
  });
});

describe('GET /health', () => {
  it('200 + status:ok を返す', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});
