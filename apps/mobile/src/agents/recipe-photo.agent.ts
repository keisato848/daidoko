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
import { getLocale, t } from '../i18n';

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
  /** Which path produced the draft. 'cloud' is the paid/metered AI call. */
  source?: 'cloud' | 'on-device';
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

/** クラウド推論が失敗したときの理由。端末内フォールバックも失敗した場合はこれを出す。 */
interface CloudFailure {
  kind: string | undefined;
  message: string;
}

/**
 * ユーザーに出す文言。**端末内フォールバック（ML Kit）の内部エラーを出さない**ための関数。
 *
 * 実際に「Waiting for the label optional module to be downloaded. Please wait.」という
 * 英語の内部文言がそのまま画面に出ていた（Issue #120）。本当の原因はクラウド側の失敗
 * （オフライン・利用枠切れ）なので、そちらを人間の言葉で伝える。
 */
function failureMessage(failure: CloudFailure | null): string {
  if (!failure) return t('error.photoRecipeFailed');
  // **原因が分かっている種別は、必ず辞書から出す。**
  // failure.message はサーバー由来で日本語固定のため、英語ロケールで
  // サーバーの言語がそのまま画面に出てしまう（ロケール横断テストで発覚）。
  switch (failure.kind) {
    case 'offline':
      return t('error.offline');
    case 'quota_exceeded':
      return t('error.quotaExceeded');
    case 'transient':
      return t('error.transient');
    default:
      // 種別が分からないときだけ上流の文言に頼る。何も無いよりはましなため
      return failure.message || t('error.photoRecipeFailed');
  }
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
  if (!input.imageUri.trim()) return errorResult(t('recipe.photo.noImage'));

  const preprocessImage = dependencies.preprocessImage ?? defaultPreprocessImage;
  const visionWarnings: string[] = [];
  let cloudFailure: CloudFailure | null = null;

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
          labelSummary: t('recipe.photo.labelSummary'),
          warnings: vision.warnings,
          imageUri: input.imageUri,
          ...(visionImageUri !== input.imageUri && { processedImageUri: visionImageUri }),
          evidenceSummary: t('recipe.photo.evidenceSummary'),
          source: 'cloud',
        },
      };
    } catch (error) {
      // When the model is confident the photo is not a dish, surface a clear
      // error instead of falling back to a misleading on-device heuristic draft.
      const kind = (error as { kind?: string } | null)?.kind;
      if (kind === 'not_a_dish') {
        return errorResult(error instanceof Error ? error.message : t('error.notADish'));
      }
      // Transient / other failures: degrade gracefully to the on-device path.
      // 端末内フォールバックも失敗したときに本当の原因を出せるよう、理由を控えておく。
      cloudFailure = {
        kind,
        message: error instanceof Error ? error.message : '',
      };
      visionWarnings.push(
        error instanceof Error
          ? t('recipe.photo.fallbackWithReason', { reason: error.message })
          : t('recipe.photo.fallback'),
      );
    }
  }

  // 2/3. On-device fallback: image-label heuristic (+ OCR text if present).
  if (!dependencies.labelImage) {
    return errorResult(failureMessage(cloudFailure));
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
                source: 'on-device',
                warnings: [
                  ...warnings,
                  ...recognized.warnings,
                  ...parsed.warnings,
                  t('recipeImport.ocr.appliedToForm'),
                  ...labelInferred.warnings,
                ],
              },
            };
          }
          warnings.push(t('recipeImport.ocr.readButUnconvertible'));
        } else if (recognized.rawText.trim()) {
          warnings.push(t('recipeImport.ocr.tooLittleText'));
        }
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? t('recipeImport.ocr.skippedWithReason', { reason: error.message })
            : t('recipeImport.ocr.skipped'),
        );
      }
    }

    // 画像ラベルだけの下書きは、日本語の料理名から日本語の材料・手順を組み立てる
    // 辞書に頼っている（recipe-photo-inference.service）。日本語以外の表示で返すと
    // **中身が丸ごと日本語の下書き**になってしまうので、その言語では出さずに
    // クラウド側の失敗理由をそのまま返す。OCR で画像内の文字を読めた場合は
    // 中身が利用者の画像そのものなので、上の分岐でそのまま返している。
    if (getLocale() !== 'ja') {
      return errorResult(failureMessage(cloudFailure));
    }

    return {
      ok: true,
      data: {
        ...labelInferred,
        imageUri: input.imageUri,
        processedImageUri: processed.imageUri !== input.imageUri ? processed.imageUri : undefined,
        evidenceSummary: combineEvidenceSummary(labelInferred.labelSummary),
        source: 'on-device',
        warnings: [...warnings, ...labelInferred.warnings],
      },
    };
  } catch {
    // 端末内フォールバックの失敗（ML Kit のモジュール未取得など）はユーザーには意味がないので、
    // その文言は出さない。クラウド側の理由が分かっていればそちらを、無ければ汎用の日本語を返す。
    return errorResult(failureMessage(cloudFailure));
  }
}

export function registerRecipePhotoAgent(dependencies: RecipePhotoAgentDependencies = {}): void {
  AgentBridge.register<RecipePhotoAgentInput, RecipePhotoAgentOutput>('A2', (input) =>
    runRecipePhotoAgent(input, dependencies),
  );
}
