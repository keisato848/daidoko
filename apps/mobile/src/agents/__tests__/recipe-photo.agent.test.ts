import { AgentBridge } from '@daidoko/shared';

import { registerRecipePhotoAgent, runRecipePhotoAgent } from '../recipe-photo.agent';
import type { ClientImageLabel } from '../../services/client-image-label.provider';
import type { OcrRecognitionResult } from '../../services/ocr.service';

function label(text: string, confidence: number): ClientImageLabel {
  return { text, confidence };
}

function recognition(rawText: string): OcrRecognitionResult {
  return { rawText, blocks: [], confidence: 'high', warnings: [] };
}

const recipeText = `チキンカレー
2人分
材料
鶏もも肉 200g
玉ねぎ 1個
カレールー 2片
作り方
1. 具材を切る
2. 炒めて水を加える
3. ルーを入れて煮る`;

afterEach(() => {
  AgentBridge._reset();
});

describe('IMG-RECIPE-AGT-01 runRecipePhotoAgent', () => {
  it('uses on-device labels to create an editable recipe draft', async () => {
    const result = await runRecipePhotoAgent(
      { imageUri: 'file:///tmp/curry.jpg' },
      { labelImage: async () => [label('Food', 0.9), label('Curry', 0.8)] },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.draft.title).toBe('写真からつくったカレー');
    expect(result.data?.warnings[0]).toContain('写真だけでは');
    expect(result.data?.source).toBe('on-device');
  });

  it('can be registered as a photo import agent on AgentBridge', async () => {
    registerRecipePhotoAgent({ labelImage: async () => [label('Food', 0.9), label('Curry', 0.8)] });

    const result = await AgentBridge.call('A2', { imageUri: 'file:///tmp/curry.jpg' });

    expect(result.ok).toBe(true);
    expect(result.data?.draft.title).toBe('写真からつくったカレー');
  });

  it('uses readable text in the image when OCR produces a recipe draft', async () => {
    const result = await runRecipePhotoAgent(
      { imageUri: 'file:///tmp/recipe-card.jpg' },
      {
        labelImage: async () => [label('Food', 0.9), label('Plate', 0.7)],
        recognizeText: async () => recognition(recipeText),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.draft.title).toBe('チキンカレー');
    expect(result.data?.draft.ingredients).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: '鶏もも肉', amount: '200g' })]),
    );
    expect(result.data?.rawText).toContain('カレールー');
    expect(result.data?.warnings).toEqual(
      expect.arrayContaining(['画像内の文字を読み取り、入力フォームに反映しました']),
    );
  });
});

describe('IMG-RECIPE-AGT-03 Vision LLM primary path', () => {
  const visionDraft = {
    title: '四川風 麻婆豆腐',
    titleReading: '',
    description: '',
    ingredients: [{ groupLabel: '', name: '木綿豆腐', amount: '1丁', note: '' }],
    steps: [{ body: '豆腐を切る' }],
    tags: ['中華'],
  };

  it('uses Vision inference when allowed and returns its draft', async () => {
    const labelImage = jest.fn(async () => [label('Food', 0.9)]);
    const result = await runRecipePhotoAgent(
      { imageUri: 'file:///tmp/mabo.jpg', context: '痺れ強め', allowCloudInference: true },
      {
        labelImage,
        inferRecipeFromVision: async () => ({
          draft: visionDraft,
          confidence: 'medium',
          warnings: ['AIがつくったレシピです。'],
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.draft.title).toBe('四川風 麻婆豆腐');
    expect(result.data?.confidence).toBe('medium');
    // Cloud path is the metered/paid one — must be tagged for quota counting.
    expect(result.data?.source).toBe('cloud');
    // Vision succeeded → on-device labeling should not be invoked.
    expect(labelImage).not.toHaveBeenCalled();
  });

  it('falls back to on-device labels when Vision inference fails', async () => {
    const result = await runRecipePhotoAgent(
      { imageUri: 'file:///tmp/curry.jpg', allowCloudInference: true },
      {
        labelImage: async () => [label('Food', 0.9), label('Curry', 0.8)],
        inferRecipeFromVision: async () => {
          throw new Error('network down');
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.draft.title).toBe('写真からつくったカレー');
    expect(result.data?.warnings.some((w) => w.includes('端末内'))).toBe(true);
    // Fell back to on-device → must NOT be counted as a paid cloud use.
    expect(result.data?.source).toBe('on-device');
  });

  it('surfaces a not-a-dish error instead of falling back', async () => {
    const labelImage = jest.fn(async () => [label('Plant', 0.9)]);
    const notADish = Object.assign(new Error('写真から料理を認識できませんでした。'), {
      kind: 'not_a_dish',
    });
    const result = await runRecipePhotoAgent(
      { imageUri: 'file:///tmp/plant.jpg', allowCloudInference: true },
      {
        labelImage,
        inferRecipeFromVision: async () => {
          throw notADish;
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('料理を認識できませんでした');
    // Must NOT fall back to the on-device heuristic for a confident not-a-dish.
    expect(labelImage).not.toHaveBeenCalled();
  });

  it('skips Vision when not opted in (allowCloudInference falsy)', async () => {
    const inferRecipeFromVision = jest.fn();
    const result = await runRecipePhotoAgent(
      { imageUri: 'file:///tmp/curry.jpg' },
      {
        labelImage: async () => [label('Food', 0.9), label('Curry', 0.8)],
        inferRecipeFromVision,
      },
    );

    expect(result.ok).toBe(true);
    expect(inferRecipeFromVision).not.toHaveBeenCalled();
  });
});

describe('IMG-RECIPE-AGT-02 runRecipePhotoAgent errors', () => {
  it('returns PHOTO_RECIPE_FAILED when the client label provider is missing', async () => {
    const result = await runRecipePhotoAgent({ imageUri: 'file:///tmp/curry.jpg' });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'PHOTO_RECIPE_FAILED',
        message: '画像ラベル provider が設定されていません',
        retryable: true,
      },
    });
  });

  it('preserves preprocess warnings in the result banner', async () => {
    const result = await runRecipePhotoAgent(
      { imageUri: 'file:///tmp/curry.jpg' },
      {
        preprocessImage: async () => ({
          imageUri: 'file:///tmp/curry-small.jpg',
          warnings: ['縮小しました'],
        }),
        labelImage: async () => [label('Food', 0.9)],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.processedImageUri).toBe('file:///tmp/curry-small.jpg');
    expect(result.data?.warnings).toEqual(expect.arrayContaining(['縮小しました']));
  });
});
