/**
 * Integration tests for POST /api/v1/infer/receipt
 * vitest + Hono with an injected Receipt Vision provider (no network).
 */
import { afterEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { setReceiptProviderForTesting } from '../routes/infer.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import {
  ReceiptVisionRequestError,
  type ReceiptVisionProvider,
  type ReceiptVisionRaw,
} from '../lib/receipt-vision.js';

const VALID_RECEIPT: ReceiptVisionRaw = {
  isReceipt: true,
  store: 'だいどこスーパー',
  items: [{ name: '牛乳' }, { name: '卵' }, { name: '豚こま切れ肉' }],
  confidence: 'high',
};

function stubProvider(impl: ReceiptVisionProvider['infer']): void {
  setReceiptProviderForTesting({ infer: impl });
}

const TINY_BASE64 = Buffer.from('fake-jpeg-bytes').toString('base64');

function post(body: unknown, headers: Record<string, string> = {}) {
  return app.request('/api/v1/infer/receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  setReceiptProviderForTesting(null);
  resetRateLimitForTesting();
  delete process.env['INFER_DAILY_LIMIT'];
  delete process.env['INFER_GLOBAL_DAILY_LIMIT'];
});

describe('POST /api/v1/infer/receipt', () => {
  describe('バリデーション', () => {
    it('画像がなければ 400', async () => {
      const res = await post({ mimeType: 'image/jpeg' });
      expect(res.status).toBe(400);
    });

    it('未対応の mimeType は 400', async () => {
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/gif' });
      expect(res.status).toBe(400);
    });
  });

  describe('成功ケース', () => {
    it('レシート写真 → ok:true, 品目リストを返す', async () => {
      stubProvider(async () => VALID_RECEIPT);
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        data?: ReceiptVisionRaw;
      };
      expect(body.ok).toBe(true);
      expect(body.data?.isReceipt).toBe(true);
      expect(body.data?.items?.map((i) => i.name)).toEqual(['牛乳', '卵', '豚こま切れ肉']);
      expect(body.data?.confidence).toBe('high');
    });

    it('レシートでない画像 → ok:true, isReceipt=false（判定はクライアント側）', async () => {
      stubProvider(async () => ({ isReceipt: false, items: [] }));
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
      const body = (await res.json()) as { ok: boolean; data?: ReceiptVisionRaw };
      expect(body.ok).toBe(true);
      expect(body.data?.isReceipt).toBe(false);
    });
  });

  describe('エラーケース', () => {
    it('プロバイダ失敗 → ok:false, AI_INFER_FAILED (retryable)', async () => {
      stubProvider(async () => {
        throw new ReceiptVisionRequestError('boom');
      });
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
      const body = (await res.json()) as {
        ok: boolean;
        error?: { code: string; retryable: boolean };
      };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('AI_INFER_FAILED');
      expect(body.error?.retryable).toBe(true);
    });
  });

  describe('レート制限（photo/meal と同じグローバル枠を共有）', () => {
    it('global 上限超過で RATE_LIMITED', async () => {
      process.env['INFER_DAILY_LIMIT'] = '0';
      process.env['INFER_GLOBAL_DAILY_LIMIT'] = '2';
      stubProvider(async () => VALID_RECEIPT);
      let lastBody: { ok: boolean; error?: { code: string } } = { ok: true };
      for (let i = 0; i < 3; i++) {
        const res = await post(
          { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' },
          { 'x-forwarded-for': `10.1.0.${i + 1}` },
        );
        lastBody = (await res.json()) as { ok: boolean; error?: { code: string } };
      }
      expect(lastBody.ok).toBe(false);
      expect(lastBody.error?.code).toBe('RATE_LIMITED');
    });
  });
});
