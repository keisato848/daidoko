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
import { recipeFormSchema, type RecipeFormData } from '../validation/recipe.schema';

export interface RecipePhotoAgentInput {
  imageUri: string;
  /** Optional free-text notes (taste, restaurant, etc.) for Vision inference. */
  context?: string;
  /** Whether cloud Vision inference is permitted (user opt-in). */
  allowCloudInference?: boolean;
}

export interface VisionInferenceData {
  draft: RecipeFormData;
  confidence: PhotoRecipeConfidence;
  warnings: string[];
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
  /** Cloud Vision LLM inference (primary path when allowed). Throws on failure. */
  inferRecipeFromVision?: (args: {
    imageUri: string;
    context?: string;
  }) => Promise<VisionInferenceData>;
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

  const preprocessImage = dependencies.preprocessImage ?? defaultPreprocessImage;
  const visionWarnings: string[] = [];

  // 1. Cloud Vision LLM inference (primary path, when the user has opted in).
  //    On any failure we fall through to the on-device heuristic / OCR path.
  if (input.allowCloudInference && dependencies.inferRecipeFromVision) {
    let visionImageUri = input.imageUri;
    try {
      const processed = await preprocessImage(input.imageUri);
      visionImageUri = processed.imageUri;
    } catch {
      // resize failed — send the original image instead
    }
    try {
      const vision = await dependencies.inferRecipeFromVision({
        imageUri: visionImageUri,
        ...(input.context !== undefined && { context: input.context }),
      });
      return {
        ok: true,
        data: {
          draft: vision.draft,
          confidence: vision.confidence,
          labels: [],
          labelSummary: 'AI 推論',
          warnings: vision.warnings,
          imageUri: input.imageUri,
          ...(visionImageUri !== input.imageUri && { processedImageUri: visionImageUri }),
          evidenceSummary: 'AI による推論',
        },
      };
    } catch (error) {
      // When the model is confident the photo is not a dish, surface a clear
      // error instead of falling back to a misleading on-device heuristic draft.
      const kind = (error as { kind?: string } | null)?.kind;
      if (kind === 'not_a_dish') {
        return errorResult(
          error instanceof Error
            ? error.message
            : '写真から料理を認識できませんでした。料理がはっきり写った写真でお試しください。',
        );
      }
      // Transient / other failures: degrade gracefully to the on-device path.
      visionWarnings.push(
        error instanceof Error
          ? `AI 推論に失敗したため端末内推測に切り替えました: ${error.message}`
          : 'AI 推論に失敗したため端末内推測に切り替えました',
      );
    }
  }

  // 2/3. On-device fallback: image-label heuristic (+ OCR text if present).
  if (!dependencies.labelImage) {
    return errorResult(visionWarnings[0] ?? '画像ラベル provider が設定されていません');
  }

  try {
    const processed = await preprocessImage(input.imageUri);
    const labels = await dependencies.labelImage(processed.imageUri);
    const labelInferred = dependencies.inferRecipe
      ? dependencies.inferRecipe(labels)
      : inferRecipeFromPhotoLabels(labels);
    const warnings = [...visionWarnings, ...(processed.warnings ?? [])];

    if (dependencies.recognizeText) {
      try {
        const recognized = await dependencies.recognizeText(processed.imageUri);
        if (hasEnoughOcrText(recognized.rawText)) {
          const parsed = dependencies.parseText
            ? await dependencies.parseText(recognized.rawText)
            : await parseOcrText(recognized.rawText);

          if (recipeFormSchema.safeParse(parsed.formData).success) {
            const evidenceSummary = combineEvidenceSummary(
              labelInferred.labelSummary,
              recognized.rawText,
            );

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
