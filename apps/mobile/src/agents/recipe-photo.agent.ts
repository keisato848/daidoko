/**
 * RecipePhotoAgent — food photo to editable recipe draft orchestration boundary.
 */
import { AgentBridge, type AgentResult } from '@daidoko/shared';

import {
  inferRecipeFromPhotoLabels,
  type PhotoRecipeConfidence,
  type RecipePhotoInferenceResult,
} from '../services/recipe-photo-inference.service';
import type { ClientImageLabel } from '../services/client-image-label.provider';
import { hasEnoughOcrText, parseOcrText, type OcrRecognitionResult } from '../services/ocr.service';
import type { ParseConfidence, ParsedRecipeText } from '../utils/recipeTextParser';
import { recipeFormSchema } from '../validation/recipe.schema';

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
  rawText?: string;
  normalizedText?: string;
  evidenceSummary?: string;
}

export interface RecipePhotoAgentDependencies {
  preprocessImage?: (imageUri: string) => Promise<RecipePhotoPreprocessResult>;
  labelImage?: (imageUri: string) => Promise<ClientImageLabel[]>;
  inferRecipe?: (labels: ClientImageLabel[]) => RecipePhotoInferenceResult;
  recognizeText?: (imageUri: string) => Promise<OcrRecognitionResult>;
  parseText?: (rawText: string) => Promise<ParsedRecipeText & { normalizedText: string }>;
}

function errorResult(message: string): AgentResult<RecipePhotoAgentOutput> {
  return { ok: false, error: { code: 'PHOTO_RECIPE_FAILED', message, retryable: true } };
}

async function defaultPreprocessImage(imageUri: string): Promise<RecipePhotoPreprocessResult> {
  return { imageUri };
}

function mapParseConfidence(confidence: ParseConfidence): PhotoRecipeConfidence {
  if (confidence === 'high') return 'high';
  if (confidence === 'medium') return 'medium';
  return 'low';
}

function summarizeText(rawText: string): string {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(' / ');
}

function combineEvidenceSummary(labelSummary: string, rawText?: string): string {
  const textSummary = rawText ? summarizeText(rawText) : '';
  return [textSummary ? `OCR: ${textSummary}` : '', labelSummary ? `Labels: ${labelSummary}` : '']
    .filter(Boolean)
    .join(' / ');
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
    const labelInferred = dependencies.inferRecipe
      ? dependencies.inferRecipe(labels)
      : inferRecipeFromPhotoLabels(labels);
    const warnings = [...(processed.warnings ?? [])];

    if (dependencies.recognizeText) {
      try {
        const recognized = await dependencies.recognizeText(processed.imageUri);
        if (hasEnoughOcrText(recognized.rawText)) {
          const parsed = dependencies.parseText
            ? await dependencies.parseText(recognized.rawText)
            : await parseOcrText(recognized.rawText);

          if (recipeFormSchema.safeParse(parsed.formData).success) {
            const evidenceSummary = combineEvidenceSummary(labelInferred.labelSummary, recognized.rawText);

            return {
              ok: true,
              data: {
                ...labelInferred,
                draft: parsed.formData,
                confidence: mapParseConfidence(parsed.confidence),
                imageUri: input.imageUri,
                processedImageUri:
                  processed.imageUri !== input.imageUri ? processed.imageUri : undefined,
                rawText: recognized.rawText,
                normalizedText: parsed.normalizedText,
                evidenceSummary,
                warnings: [
                  ...warnings,
                  ...recognized.warnings,
                  ...parsed.warnings,
                  '画像内の文字を読み取り、入力フォームに反映しました',
                  ...labelInferred.warnings,
                ],
              },
            };
          }
          warnings.push('画像内の文字は読めましたが、レシピ入力形式に変換できませんでした');
        } else if (recognized.rawText.trim()) {
          warnings.push('画像内の文字量が少ないため、画像ラベルから下書きしました');
        }
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `画像内テキストの読み取りをスキップしました: ${error.message}`
            : '画像内テキストの読み取りをスキップしました',
        );
      }
    }

    return {
      ok: true,
      data: {
        ...labelInferred,
        imageUri: input.imageUri,
        processedImageUri: processed.imageUri !== input.imageUri ? processed.imageUri : undefined,
        evidenceSummary: combineEvidenceSummary(labelInferred.labelSummary),
        warnings: [...warnings, ...labelInferred.warnings],
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
