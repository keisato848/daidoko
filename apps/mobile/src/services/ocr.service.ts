/**
 * OCR service — deterministic OCR text normalization and parser handoff.
 */
import type { ParseConfidence, ParsedRecipeText } from '../utils/recipeTextParser';
import {
  parseRecipeTextWithAssistance,
  type ParseRecipeTextWithAssistanceOptions,
} from '../utils/recipeTextNormalizer';

export interface OcrTextLine {
  text: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface OcrTextBlock {
  text: string;
  lines: OcrTextLine[];
}

export interface OcrRecognitionResult {
  rawText: string;
  blocks: OcrTextBlock[];
  confidence: ParseConfidence;
  warnings: string[];
}

export const MIN_OCR_TEXT_LENGTH = 20;

function normalizeLine(value: string): string {
  return value
    .replace(/[\t　]+/g, ' ')
    .replace(/\s+([:：])/g, '$1')
    .replace(
      /([（(【\[])?\s*(材料|食材|具材|作り方|つくり方|手順|工程|メモ|ポイント)\s*([）)】\]])?\s*[:：]?$/u,
      '$2',
    )
    .replace(/^(?:page|p)\.?\s*\d+$/i, '')
    .replace(/^[-—_=]{2,}$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeOcrText(rawText: string): string {
  const lines = rawText.replace(/\r/g, '\n').split('\n').map(normalizeLine).filter(Boolean);

  return lines.join('\n');
}

export function hasEnoughOcrText(rawText: string): boolean {
  return normalizeOcrText(rawText).replace(/\s/g, '').length >= MIN_OCR_TEXT_LENGTH;
}

export async function parseOcrText(
  rawText: string,
  options: ParseRecipeTextWithAssistanceOptions = {},
): Promise<ParsedRecipeText & { normalizedText: string }> {
  const normalizedText = normalizeOcrText(rawText);
  const parsed = await parseRecipeTextWithAssistance(normalizedText, options);
  return { ...parsed, normalizedText };
}
