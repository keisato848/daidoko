/**
 * Integration tests for POST /api/v1/infer/receipt
 * vitest + Hono with an injected Receipt Vision provider (no network).
 */
import { afterEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { setReceiptProviderForTesting } from '../routes/infer.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import {
  isReceiptTextInput,
  ReceiptVisionRequestError,
  type ReceiptVisionInput,
  type ReceiptVisionProvider,
  type ReceiptVisionRaw,
} from '../lib/receipt-vision.js';

const VALID_RECEIPT: ReceiptVisionRaw = {
  isReceipt: true,
  store: 'だいどこスーパー',
  items: [
    { name: '牛乳', quantity: 2, unit: '本' },
    { name: '卵', quantity: 1, unit: 'パック' },
    // 数量が読めなかった行（レシートでは普通に起きる）
    { name: '豚こま切れ肉' },
  ],
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

    it('数量・単位をそのまま返す（読めなかった行は数量なしで返る）', async () => {
      stubProvider(async () => VALID_RECEIPT);
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
      const body = (await res.json()) as { ok: boolean; data?: ReceiptVisionRaw };
      expect(body.data?.items?.[0]).toEqual({ name: '牛乳', quantity: 2, unit: '本' });
      // 読めなかった数量は 1 で埋めず、欠けたまま返す（在庫は合算なので推測は積もる）
      expect(body.data?.items?.[2]?.quantity).toBeUndefined();
      expect(body.data?.items?.[2]?.unit).toBeUndefined();
    });

    it('レシートでない画像 → ok:true, isReceipt=false（判定はクライアント側）', async () => {
      stubProvider(async () => ({ isReceipt: false, items: [] }));
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
      const body = (await res.json()) as { ok: boolean; data?: ReceiptVisionRaw };
      expect(body.ok).toBe(true);
      expect(body.data?.isReceipt).toBe(false);
    });
  });

  describe('テキスト入力（端末内 OCR の文字起こし）', () => {
    it('ocrText だけでも通り、画像ではなくテキストがプロバイダに渡る', async () => {
      let seen: ReceiptVisionInput | null = null;
      stubProvider(async (input) => {
        seen = input;
        return VALID_RECEIPT;
      });
      const res = await post({ ocrText: 'だいどこスーパー\n牛乳 2本 ¥398' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data?: ReceiptVisionRaw };
      expect(body.ok).toBe(true);
      // 画像経路と同じ構造化出力（スキーマも後処理も共用しているのが要点）
      expect(body.data?.items?.[0]).toEqual({ name: '牛乳', quantity: 2, unit: '本' });
      const input = seen as ReceiptVisionInput | null;
      expect(input && isReceiptTextInput(input)).toBe(true);
      expect(input).not.toHaveProperty('imageBase64');
    });

    it('空のテキストは 400（読めなかったなら画像で送るべきで、空送信は無駄な推論になる）', async () => {
      const res = await post({ ocrText: '' });
      expect(res.status).toBe(400);
    });

    it('長すぎるテキストは 400', async () => {
      const res = await post({ ocrText: 'あ'.repeat(20_001) });
      expect(res.status).toBe(400);
    });

    it('画像入力はこれまでどおり画像として渡る（旧バージョンのアプリが送ってくる）', async () => {
      let seen: ReceiptVisionInput | null = null;
      stubProvider(async (input) => {
        seen = input;
        return VALID_RECEIPT;
      });
      await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
      const input = seen as ReceiptVisionInput | null;
      expect(input && isReceiptTextInput(input)).toBe(false);
      expect(input).toMatchObject({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
    });
  });

  describe('語彙防御（水平展開規約②）', () => {
    it('カテゴリ語・売り場名の品目はルートを通ると落ちる（生出力を素通ししない）', async () => {
      stubProvider(async () => ({
        isReceipt: true,
        items: [{ name: '牛乳', quantity: 1, unit: '本' }, { name: '調味料' }, { name: '水産' }],
      }));
      const res = await post({ imageBase64: TINY_BASE64, mimeType: 'image/jpeg' });
      const body = (await res.json()) as { ok: boolean; data?: ReceiptVisionRaw };
      expect(body.ok).toBe(true);
      expect(body.data?.items?.map((i) => i.name)).toEqual(['牛乳']);
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
