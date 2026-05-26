/**
 * A2: OCRAgent — image OCR orchestration boundary.
 */
import { AgentBridge, type AgentResult } from '@daidoko/shared';

import { hasEnoughOcrText, parseOcrText, type OcrRecognitionResult } from '../services/ocr.service';
import type { RecipeFormData } from '../validation/recipe.schema';
import { recipeFormSchema } from '../validation/recipe.schema';
import type { ParseConfidence, ParsedRecipeText } from '../utils/recipeTextParser';

export interface OcrAgentInput {
  imageUri: string;
  useServerAI?: boolean;
}

export interface OcrAgentOutput {
  draft: RecipeFormData;
  rawText: string;
  normalizedText: string;
  imageUri: string;
  processedImageUri?: string;
  confidence: ParseConfidence;
  warnings: string[];
}

export interface OcrPreprocessResult {
  imageUri: string;
  warnings?: string[];
}

export interface OcrAgentDependencies {
  preprocessImage?: (imageUri: string) => Promise<OcrPreprocessResult>;
  recognizeText?: (imageUri: string) => Promise<OcrRecognitionResult>;
  parseText?: (rawText: string) => Promise<ParsedRecipeText & { normalizedText: string }>;
}

function errorResult(
  code: 'OCR_FAILED' | 'PARSE_FAILED',
  message: string,
): AgentResult<OcrAgentOutput> {
  return { ok: false, error: { code, message, retryable: code === 'OCR_FAILED' } };
}

async function defaultPreprocessImage(imageUri: string): Promise<OcrPreprocessResult> {
  return { imageUri };
}

export async function runOcrAgent(
  input: OcrAgentInput,
  dependencies: OcrAgentDependencies = {},
): Promise<AgentResult<OcrAgentOutput>> {
  if (!input.imageUri.trim()) {
    return errorResult('OCR_FAILED', '画像が選択されていません');
  }
  if (!dependencies.recognizeText) {
    return errorResult('OCR_FAILED', 'OCR provider is not configured');
  }

  try {
    const preprocessImage = dependencies.preprocessImage ?? defaultPreprocessImage;
    const processed = await preprocessImage(input.imageUri);
    const recognized = await dependencies.recognizeText(processed.imageUri);

    if (!hasEnoughOcrText(recognized.rawText)) {
      return errorResult('OCR_FAILED', 'テキストが少なすぎます。より鮮明な画像で試してください。');
    }

    const parsed = dependencies.parseText
      ? await dependencies.parseText(recognized.rawText)
      : await parseOcrText(recognized.rawText);

    if (!recipeFormSchema.safeParse(parsed.formData).success) {
      return errorResult('PARSE_FAILED', 'レシピとして必要な項目を読み取れませんでした');
    }

    return {
      ok: true,
      data: {
        draft: parsed.formData,
        rawText: recognized.rawText,
        normalizedText: parsed.normalizedText,
        imageUri: input.imageUri,
        processedImageUri: processed.imageUri !== input.imageUri ? processed.imageUri : undefined,
        confidence: parsed.confidence,
        warnings: [...(processed.warnings ?? []), ...recognized.warnings, ...parsed.warnings],
      },
    };
  } catch (error) {
    return errorResult(
      'OCR_FAILED',
      error instanceof Error ? error.message : 'OCR 処理に失敗しました',
    );
  }
}

export function registerOcrAgent(dependencies: OcrAgentDependencies = {}): void {
  AgentBridge.register<OcrAgentInput, OcrAgentOutput>('A2', (input) =>
    runOcrAgent(input, dependencies),
  );
}
