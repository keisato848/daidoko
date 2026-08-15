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

/**
 * 端末内 OCR で写真を文字起こしする。**取れなければ null**。
 *
 * 「モジュールが無い」「モデルが未取得」「認識に失敗した」「1文字も読めなかった」を
 * すべて null に潰すのが仕事。呼び出し側はこの1つの答えだけを見て画像経路へ落とせる
 * （`docs/在庫・レシート設計レビュー.md` §3.4）。
 *
 * **例外を投げない。** ML Kit の生のエラー文字列（英語・モデル ID 入り）が画面に
 * 出ていたのが、初回のレシート読み取りが壊れて見えた原因だった（§1 症状2）。
 */
export async function recognizeTextOnDevice(imageUri: string): Promise<string | null> {
  const module = getNativeClientOcrModule();
  if (!module) return null;
  try {
    if (!(await module.isAvailable())) return null;
    const result = await module.recognizeImage(imageUri);
    const rawText = typeof result?.rawText === 'string' ? result.rawText.trim() : '';
    return rawText || null;
  } catch {
    return null;
  }
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
