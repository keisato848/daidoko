import { NativeModules } from 'react-native';

import {
  parseRecipeText,
  RECIPE_TEXT_AI_PROMPT,
  type ParseConfidence,
  type ParsedRecipeText,
  type RecipeTextParseSource,
} from './recipeTextParser';
import { recipeFormSchema } from '../validation/recipe.schema';

export interface RecipeTextNormalizerInput {
  rawText: string;
  parsed: ParsedRecipeText;
}

export interface RecipeTextNormalizerOutput {
  ok: true;
  text: string;
  source: Exclude<RecipeTextParseSource, 'parser'>;
  modelName?: string;
}

export interface RecipeTextNormalizerFailure {
  ok: false;
  source: Exclude<RecipeTextParseSource, 'parser'>;
  reason: string;
}

export interface RecipeTextNormalizerProvider {
  source: Exclude<RecipeTextParseSource, 'parser'>;
  isAvailable: () => Promise<boolean>;
  normalize: (input: RecipeTextNormalizerInput) => Promise<RecipeTextNormalizerOutput | RecipeTextNormalizerFailure>;
}

export interface ParseRecipeTextWithAssistanceOptions {
  providers?: RecipeTextNormalizerProvider[];
  targetConfidence?: ParseConfidence;
}

interface NativeRecipeTextLlmModule {
  isAvailable: () => Promise<boolean>;
  getModelInfo?: () => Promise<{ modelName?: string }>;
  normalizeRecipeText: (prompt: string, rawText: string) => Promise<string>;
}

const CONFIDENCE_SCORE: Record<ParseConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const TARGET_CONFIDENCE: ParseConfidence = 'high';
const INGREDIENT_AMOUNT_PATTERN =
  /([ぁ-んァ-ヶー一-龠々〆A-Za-z0-9０-９・\s　]+?)(約?(?:\d+|[０-９]+)(?:[./／](?:\d+|[０-９]+))?\s*(?:g|kg|ml|l|L|cc|個|こ|本|枚|束|袋|缶|切れ|尾|杯|合|片|かけ))/g;
const SPOON_AMOUNT_PATTERN =
  /([ぁ-んァ-ヶー一-龠々〆A-Za-z0-9０-９・\s　]+?)((?:大さじ|小さじ|カップ)\s*(?:\d+|[０-９]+)(?:[./／](?:\d+|[０-９]+))?)/g;
const KEYWORD_AMOUNT_PATTERN =
  /([ぁ-んァ-ヶー一-龠々〆A-Za-z0-9０-９・\s　]+?)(適量|少々|ひとつまみ|お好み)/g;
const OPERATION_PATTERN =
  /(切る|刻む|炒める|煮込む|煮る|焼く|混ぜる|加える|入れる|溶く|とじる|ゆでる|茹でる|揚げる|炊く|盛る|かける|和える|蒸す|冷ます|温める|のせる|洗う|むく)/;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(normalizeDigits(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function confidenceAtLeast(actual: ParseConfidence, target: ParseConfidence): boolean {
  return CONFIDENCE_SCORE[actual] >= CONFIDENCE_SCORE[target];
}

function improvesConfidence(candidate: ParsedRecipeText, base: ParsedRecipeText): boolean {
  if (CONFIDENCE_SCORE[candidate.confidence] > CONFIDENCE_SCORE[base.confidence]) return true;
  const candidateIngredientCount = candidate.formData.ingredients.filter((item) => item.name.trim()).length;
  const baseIngredientCount = base.formData.ingredients.filter((item) => item.name.trim()).length;
  const candidateStepCount = candidate.formData.steps.filter((item) => item.body.trim()).length;
  const baseStepCount = base.formData.steps.filter((item) => item.body.trim()).length;
  return candidateIngredientCount > baseIngredientCount || candidateStepCount > baseStepCount;
}

function isNativeRecipeTextLlmModule(value: unknown): value is NativeRecipeTextLlmModule {
  if (typeof value !== 'object' || value == null) return false;
  const candidate = value as {
    isAvailable?: unknown;
    normalizeRecipeText?: unknown;
  };
  return typeof candidate.isAvailable === 'function' && typeof candidate.normalizeRecipeText === 'function';
}

function getNativeRecipeTextLlmModule(): NativeRecipeTextLlmModule | null {
  const moduleCandidate: unknown = NativeModules['DaidokoRecipeTextLlm'];
  return isNativeRecipeTextLlmModule(moduleCandidate) ? moduleCandidate : null;
}

export function buildRecipeTextNormalizationPrompt(rawText: string): string {
  return `${RECIPE_TEXT_AI_PROMPT}${rawText.trim()}`;
}

export function createGemmaNativeRecipeTextNormalizer(): RecipeTextNormalizerProvider {
  return {
    source: 'gemma-native',
    async isAvailable() {
      const module = getNativeRecipeTextLlmModule();
      return module ? module.isAvailable() : false;
    },
    async normalize(input) {
      const module = getNativeRecipeTextLlmModule();
      if (!module || !(await module.isAvailable())) {
        return { ok: false, source: 'gemma-native', reason: 'Gemma native provider is unavailable' };
      }

      try {
        const modelInfo = await module.getModelInfo?.();
        const text = await module.normalizeRecipeText(
          buildRecipeTextNormalizationPrompt(input.rawText),
          input.rawText,
        );
        return {
          ok: true,
          source: 'gemma-native',
          text,
          modelName: modelInfo?.modelName,
        };
      } catch (error) {
        return {
          ok: false,
          source: 'gemma-native',
          reason: error instanceof Error ? error.message : 'Gemma inference failed',
        };
      }
    },
  };
}

function inferTitle(rawText: string, parsed: ParsedRecipeText): string {
  const parsedTitle = parsed.formData.title.trim();
  if (parsedTitle && parsedTitle.length <= 30 && !OPERATION_PATTERN.test(parsedTitle)) return parsedTitle;

  const firstLine = rawText
    .split(/\r?\n/)
    .map(normalizeWhitespace)
    .find(Boolean);
  if (firstLine && firstLine.length <= 30 && !/[\d０-９]/.test(firstLine)) return firstLine;

  const firstSentence = normalizeWhitespace(rawText.split(/[。.!！?？\n]/)[0] ?? '');
  const subjectMatch = firstSentence.match(/^(.{1,24}?)(?:は|を|の作り方|レシピ)/);
  return normalizeWhitespace(subjectMatch?.[1] ?? parsedTitle).replace(/[、,。.!！?？]+$/, '');
}

function cleanIngredientName(value: string): string {
  const segments = value
    .replace(/^(?:材料|具材|使うもの|用意するもの)[:：]?/, '')
    .split(/(?:そして|あと|または|また|それから|なら|には|は|を|が|に|で|と|、|,|。|\s+)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return normalizeWhitespace(segments.at(-1) ?? value).replace(/[：:、,。]+$/, '');
}

function collectIngredientMatches(rawText: string): { name: string; amount: string }[] {
  const matches: { name: string; amount: string }[] = [];
  const seen = new Set<string>();

  const addMatches = (pattern: RegExp) => {
    for (const match of rawText.matchAll(pattern)) {
      const name = cleanIngredientName(match[1] ?? '');
      const amount = normalizeWhitespace(match[2] ?? '');
      if (!name || !amount || name.length > 40) continue;
      const key = `${name}:${amount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({ name, amount });
    }
  };

  addMatches(SPOON_AMOUNT_PATTERN);
  addMatches(INGREDIENT_AMOUNT_PATTERN);
  addMatches(KEYWORD_AMOUNT_PATTERN);

  return matches;
}

function collectStepSentences(rawText: string): string[] {
  const steps: string[] = [];
  const seen = new Set<string>();
  const sentences = rawText
    .split(/[。.!！?？\n]+/)
    .map(normalizeWhitespace)
    .filter(Boolean);

  for (const sentence of sentences) {
    if (!OPERATION_PATTERN.test(sentence)) continue;
    const cleaned = sentence
      .replace(/^.{1,24}?(?:は|なら|では)[、,\s]*/, '')
      .replace(/^(?:作り方|手順|工程)[:：]?\s*/, '')
      .trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    steps.push(cleaned);
  }

  return steps;
}

function normalizeWithLocalHeuristics(rawText: string, parsed: ParsedRecipeText): string | null {
  const title = inferTitle(rawText, parsed);
  const ingredients = collectIngredientMatches(rawText);
  const steps = collectStepSentences(rawText);
  const servings = parsed.formData.servings ?? parsePositiveInt(rawText.match(/(\d+|[０-９]+)\s*(?:人分|人前)/)?.[1]);
  const cookTimeMin =
    parsed.formData.cookTimeMin ??
    parsePositiveInt(rawText.match(/(?:調理時間|所要時間|cook(?:ing)? time)\D*(\d+|[０-９]+)/i)?.[1]);
  const prepTimeMin =
    parsed.formData.prepTimeMin ??
    parsePositiveInt(rawText.match(/(?:下準備|準備時間|prep(?:aration)? time)\D*(\d+|[０-９]+)/i)?.[1]);

  if (!title || ingredients.length === 0 || steps.length === 0) return null;

  const lines = [title];
  if (servings) lines.push(`${servings}人分`);
  if (cookTimeMin) lines.push(`調理時間 ${cookTimeMin}分`);
  if (prepTimeMin) lines.push(`下準備 ${prepTimeMin}分`);

  lines.push('', '材料');
  for (const ingredient of ingredients) {
    lines.push(`${ingredient.name} ${ingredient.amount}`);
  }

  lines.push('', '作り方');
  steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step}`);
  });

  return lines.join('\n');
}

export function createLocalHeuristicRecipeTextNormalizer(): RecipeTextNormalizerProvider {
  return {
    source: 'local-heuristic',
    async isAvailable() {
      return true;
    },
    async normalize(input) {
      const text = normalizeWithLocalHeuristics(input.rawText, input.parsed);
      if (!text) {
        return {
          ok: false,
          source: 'local-heuristic',
          reason: 'Local heuristic could not produce parser-friendly text',
        };
      }
      return { ok: true, source: 'local-heuristic', text };
    },
  };
}

function defaultProviders(): RecipeTextNormalizerProvider[] {
  return [createGemmaNativeRecipeTextNormalizer(), createLocalHeuristicRecipeTextNormalizer()];
}

export async function parseRecipeTextWithAssistance(
  rawText: string,
  options: ParseRecipeTextWithAssistanceOptions = {},
): Promise<ParsedRecipeText> {
  const base = parseRecipeText(rawText);
  const targetConfidence = options.targetConfidence ?? TARGET_CONFIDENCE;

  if (confidenceAtLeast(base.confidence, targetConfidence)) return base;

  const failures: string[] = [];
  for (const provider of options.providers ?? defaultProviders()) {
    if (!(await provider.isAvailable())) {
      failures.push(`${provider.source}: unavailable`);
      continue;
    }

    const output = await provider.normalize({ rawText, parsed: base });
    if (!output.ok) {
      failures.push(`${provider.source}: ${output.reason}`);
      continue;
    }

    const candidate = parseRecipeText(output.text);
    if (!recipeFormSchema.safeParse(candidate.formData).success || !improvesConfidence(candidate, base)) {
      failures.push(`${output.source}: normalized output did not improve parse confidence`);
      continue;
    }

    return {
      ...candidate,
      normalizedBy: output.source,
      normalizedText: output.text,
      warnings: output.modelName ? [`${output.modelName} で補正しました`] : [],
    };
  }

  return {
    ...base,
    warnings: [...base.warnings, ...failures],
  };
}