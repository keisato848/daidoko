import { AgentBridge } from '@daidoko/shared';

import { registerRecipePhotoAgent, runRecipePhotoAgent } from '../recipe-photo.agent';
import type { ClientImageLabel } from '../../services/client-image-label.provider';

function label(text: string, confidence: number): ClientImageLabel {
  return { text, confidence };
}

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
    expect(result.data?.draft.title).toBe('写真から推測したカレー');
    expect(result.data?.warnings[0]).toContain('写真だけでは');
  });

  it('can be registered as a photo import agent on AgentBridge', async () => {
    registerRecipePhotoAgent({ labelImage: async () => [label('Food', 0.9), label('Curry', 0.8)] });

    const result = await AgentBridge.call('A2', { imageUri: 'file:///tmp/curry.jpg' });

    expect(result.ok).toBe(true);
    expect(result.data?.draft.title).toBe('写真から推測したカレー');
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
