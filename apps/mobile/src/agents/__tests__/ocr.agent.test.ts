import { AgentBridge } from '@daidoko/shared';

import { registerOcrAgent, runOcrAgent } from '../ocr.agent';
import type { OcrRecognitionResult } from '../../services/ocr.service';

function recognition(rawText: string): OcrRecognitionResult {
  return { rawText, blocks: [], confidence: 'high', warnings: [] };
}

const recipeText = `肉じゃが
4人分
材料
じゃがいも 3個
玉ねぎ 1個
作り方
1. 切る
2. 煮る`;

afterEach(() => {
  AgentBridge._reset();
});

describe('OCR-AGT-01 runOcrAgent', () => {
  it('returns a RecipeDraft from OCR provider text', async () => {
    const result = await runOcrAgent(
      { imageUri: 'file:///tmp/recipe.jpg' },
      { recognizeText: async () => recognition(recipeText) },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.draft.title).toBe('肉じゃが');
    expect(result.data?.draft.ingredients.map((ingredient) => ingredient.name)).toEqual([
      'じゃがいも',
      '玉ねぎ',
    ]);
  });

  it('can be registered as A2 on AgentBridge', async () => {
    registerOcrAgent({ recognizeText: async () => recognition(recipeText) });

    const result = await AgentBridge.call('A2', { imageUri: 'file:///tmp/recipe.jpg' });

    expect(result.ok).toBe(true);
    expect(result.data?.draft.title).toBe('肉じゃが');
  });
});

describe('OCR-AGT-02 runOcrAgent errors', () => {
  it('OCR-SEC-01 returns OCR_FAILED without falling back to server OCR', async () => {
    const result = await runOcrAgent({ imageUri: 'file:///tmp/recipe.jpg' });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'OCR_FAILED',
        message: 'クライアントOCR providerが設定されていません',
        retryable: true,
      },
    });
  });

  it('returns OCR_FAILED when text is too short', async () => {
    const result = await runOcrAgent(
      { imageUri: 'file:///tmp/empty.jpg' },
      { recognizeText: async () => recognition('肉じゃが') },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'OCR_FAILED', retryable: true },
    });
  });

  it('returns PARSE_FAILED when OCR text cannot produce a valid recipe form', async () => {
    const result = await runOcrAgent(
      { imageUri: 'file:///tmp/noise.jpg' },
      {
        recognizeText: async () =>
          recognition(
            'これはレシピではない文章です。材料も手順もありません。読み取り結果だけが長いです。',
          ),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'PARSE_FAILED', retryable: false },
    });
  });
});
