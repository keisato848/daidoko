import { NativeModules, Platform } from 'react-native';

import type { OcrRecognitionResult } from './ocr.service';
import type { ParseConfidence } from '../utils/recipeTextParser';

interface NativeClientOcrModule {
  isAvailable: () => Promise<boolean>;
  recognizeImage: (imageUri: string) => Promise<OcrRecognitionResult>;
}

function isNativeClientOcrModule(value: unknown): value is NativeClientOcrModule {
  if (typeof value !== 'object' || value == null) return false;
  const candidate = value as { isAvailable?: unknown; recognizeImage?: unknown };
  return (
    typeof candidate.isAvailable === 'function' && typeof candidate.recognizeImage === 'function'
  );
}

function getNativeClientOcrModule(): NativeClientOcrModule | null {
  if (Platform.OS !== 'android') return null;
  const moduleCandidate: unknown = NativeModules['DaidokoOcr'];
  return isNativeClientOcrModule(moduleCandidate) ? moduleCandidate : null;
}

function normalizeConfidence(confidence: ParseConfidence | undefined): ParseConfidence {
  return confidence === 'high' || confidence === 'medium' || confidence === 'low'
    ? confidence
    : 'low';
}

export async function isClientOcrAvailable(): Promise<boolean> {
  const module = getNativeClientOcrModule();
  return module ? module.isAvailable() : false;
}

export function createClientOcrRecognizer():
  | ((imageUri: string) => Promise<OcrRecognitionResult>)
  | undefined {
  const module = getNativeClientOcrModule();
  if (!module) return undefined;
  return async (imageUri) => {
    const result = await module.recognizeImage(imageUri);
    return {
      rawText: result.rawText,
      blocks: Array.isArray(result.blocks) ? result.blocks : [],
      confidence: normalizeConfidence(result.confidence),
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
    };
  };
}
