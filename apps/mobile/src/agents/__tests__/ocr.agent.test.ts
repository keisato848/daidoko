import { AgentBridge } from '@daidoko/shared';

import { registerOcrAgent, runOcrAgent } from '../ocr.agent';
import type { OcrRecognitionResult } from '../../services/ocr.service';
import { t } from '../../i18n';

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
        message: t('recipeImport.ocr.providerNotConfigured'),
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

/**
 * 進行の条件は**保存スキーマではなく「材料か手順が読めたか」**。
 * parser は読めなかった項目に編集用の空行を 1 つ置くので、保存スキーマを条件にすると
 * 材料が読めなかった下書きは手順が読めていても行き止まりになる
 * （AQUOS でパッケージ裏を撮って発覚・2026-08-23）。
 */
describe('OCR-AGT-03 下書きの受け入れ', () => {
  it('材料が読めなくても、手順が読めていれば確認画面へ進める', async () => {
    const stepsOnly = `作り方
1. じゃがいもを耐熱皿に入れ、ラップをして電子レンジで加熱します。
2. 油を熱し、焼き目が付くまで炒めます。`;

    const result = await runOcrAgent(
      { imageUri: 'file:///tmp/package.jpg' },
      { recognizeText: async () => recognition(stepsOnly) },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.draft.steps).toHaveLength(2);
  });

  it('材料も手順も読めなければ PARSE_FAILED', async () => {
    const noise = '賞味期限:枠外下部に記載 保存方法:直射日光、高温多湿を避けて保存してください。';

    const result = await runOcrAgent(
      { imageUri: 'file:///tmp/noise.jpg' },
      { recognizeText: async () => recognition(noise), parseText: async () => emptyParse() },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'PARSE_FAILED', message: t('recipeImport.ocr.missingRequiredFields') },
    });
  });
});

function emptyParse() {
  return {
    formData: {
      title: '',
      titleReading: '',
      description: '',
      ingredients: [{ name: '', amount: '', groupLabel: '', note: '' }],
      steps: [{ body: '' }],
      tags: [],
    },
    confidence: 'low' as const,
    unparsedLines: [],
    normalizedBy: 'parser' as const,
    warnings: [],
    normalizedText: '',
  };
}
