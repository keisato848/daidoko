/**
 * RecipePhotoAgent — food photo to editable recipe draft orchestration boundary.
 */
import { AgentBridge, type AgentResult } from '@daidoko/shared';

import {
  inferRecipeFromPhotoLabels,
  type RecipePhotoInferenceResult,
} from '../services/recipe-photo-inference.service';
import type { ClientImageLabel } from '../services/client-image-label.provider';

export interface RecipePhotoAgentInput {
  imageUri: string;
}

export interface RecipePhotoPreprocessResult {
  imageUri: string;
  warnings?: string[];
}

export interface RecipePhotoAgentOutput extends RecipePhotoInferenceResult {
  imageUri: string;
  processedImageUri?: string;
}

export interface RecipePhotoAgentDependencies {
  preprocessImage?: (imageUri: string) => Promise<RecipePhotoPreprocessResult>;
  labelImage?: (imageUri: string) => Promise<ClientImageLabel[]>;
  inferRecipe?: (labels: ClientImageLabel[]) => RecipePhotoInferenceResult;
}

function errorResult(message: string): AgentResult<RecipePhotoAgentOutput> {
  return { ok: false, error: { code: 'PHOTO_RECIPE_FAILED', message, retryable: true } };
}

async function defaultPreprocessImage(imageUri: string): Promise<RecipePhotoPreprocessResult> {
  return { imageUri };
}

export async function runRecipePhotoAgent(
  input: RecipePhotoAgentInput,
  dependencies: RecipePhotoAgentDependencies = {},
): Promise<AgentResult<RecipePhotoAgentOutput>> {
  if (!input.imageUri.trim()) return errorResult('画像が選択されていません');
  if (!dependencies.labelImage) return errorResult('画像ラベル provider が設定されていません');

  try {
    const preprocessImage = dependencies.preprocessImage ?? defaultPreprocessImage;
    const processed = await preprocessImage(input.imageUri);
    const labels = await dependencies.labelImage(processed.imageUri);
    const inferred = dependencies.inferRecipe
      ? dependencies.inferRecipe(labels)
      : inferRecipeFromPhotoLabels(labels);

    return {
      ok: true,
      data: {
        ...inferred,
        imageUri: input.imageUri,
        processedImageUri: processed.imageUri !== input.imageUri ? processed.imageUri : undefined,
        warnings: [...(processed.warnings ?? []), ...inferred.warnings],
      },
    };
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : '料理写真の推測に失敗しました');
  }
}

export function registerRecipePhotoAgent(dependencies: RecipePhotoAgentDependencies = {}): void {
  AgentBridge.register<RecipePhotoAgentInput, RecipePhotoAgentOutput>('A2', (input) =>
    runRecipePhotoAgent(input, dependencies),
  );
}
