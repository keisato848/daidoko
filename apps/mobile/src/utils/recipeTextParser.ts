import type { RecipeFormData } from '../validation/recipe.schema';

import { extractPrimaryStepTimer } from './stepTimer';

export type ParseConfidence = 'high' | 'medium' | 'low';
export type RecipeTextParseSource = 'parser' | 'gemma-native' | 'local-heuristic';
type ParseMode = 'unknown' | 'ingredients' | 'steps' | 'description';

export interface ParsedRecipeText {
  formData: RecipeFormData;
  confidence: ParseConfidence;
  unparsedLines: string[];
  normalizedBy: RecipeTextParseSource;
  normalizedText?: string;
  warnings: string[];
}

export const RECIPE_TEXT_AI_PROMPT = `次のレシピ情報を、以下の形式だけで出力してください。JSON、表、Markdownの装飾、説明文は出力しないでください。

出力ルール:
- 1行目は料理名だけにする
- 人数は「2人分」のように書く
- 調理時間は「調理時間 30分」、下準備は「下準備 10分」と書く
- 材料見出しは必ず「材料」にする
- 材料は1行に1つ、「材料名 分量」の順で書く
- 手順見出しは必ず「作り方」にする
- 手順は「1. 切る」「2. 煮る」のように番号付きで書く
- 補足があれば最後に「メモ」見出しを置き、短く書く

出力形式:
料理名
2人分
調理時間 30分
下準備 10分

材料
材料名 分量
材料名 分量

作り方
1. 手順を書く
2. 手順を書く

メモ
補足を書く

変換したいレシピ情報:
`;

const EMPTY_INGREDIENT = { name: '', amount: '', groupLabel: '', note: '' };
const EMPTY_STEP = { body: '', timerSec: undefined };

const SECTION_PATTERNS: Record<Exclude<ParseMode, 'unknown'>, RegExp> = {
  ingredients: /^(?:[#\s　]*)(材料|食材|具材|ingredients?)[:：\s　]*$/i,
  steps: /^(?:[#\s　]*)(作り方|つくり方|手順|工程|方法|steps?|directions?)[:：\s　]*$/i,
  description: /^(?:[#\s　]*)(説明|メモ|ポイント|コツ|note|notes?)[:：\s　]*$/i,
};

const STEP_PATTERN = /^(?:\d+|[０-９]+|[①②③④⑤⑥⑦⑧⑨⑩])[\.)．、\s　]+(.+)$/;
const BULLET_PATTERN = /^[・*\-−—]\s*/;
const TITLE_PATTERN = /^(?:タイトル|レシピ名|name)[:：]\s*(.+)$/i;
const SERVINGS_PATTERN = /(?:^|[:：\s　])(\d+|[０-９]+)\s*(?:人分|人前| servings?)/i;
const COOK_TIME_PATTERN = /(?:調理時間|所要時間|cook(?:ing)? time)[:：\s　]*(\d+|[０-９]+)\s*分?/i;
const PREP_TIME_PATTERN =
  /(?:下準備|準備時間|prep(?:aration)? time)[:：\s　]*(\d+|[０-９]+)\s*分?/i;
const AMOUNT_KEYWORD_PATTERN = /^(適量|少々|ひとつまみ|お好み|各少々)$/;
const AMOUNT_WITH_UNIT_PATTERN =
  /^(?:約)?[\d０-９./／]+\s*(?:g|kg|ml|l|L|cc|個|こ|本|枚|束|袋|缶|切れ|尾|杯|合|片|かけ|大さじ|小さじ|カップ)(?:\s*.+)?$/;
const SPOON_AMOUNT_PATTERN = /^(?:大さじ|小さじ|カップ)\s*[\d０-９./／]+(?:\s*.+)?$/;

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(normalizeDigits(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function stripBullet(line: string): string {
  return cleanLine(line.replace(BULLET_PATTERN, ''));
}

function detectSection(line: string): ParseMode | null {
  if (SECTION_PATTERNS.ingredients.test(line)) return 'ingredients';
  if (SECTION_PATTERNS.steps.test(line)) return 'steps';
  if (SECTION_PATTERNS.description.test(line)) return 'description';
  return null;
}

function isLikelyAmount(value: string): boolean {
  const trimmed = cleanLine(value);
  return (
    AMOUNT_KEYWORD_PATTERN.test(trimmed) ||
    AMOUNT_WITH_UNIT_PATTERN.test(trimmed) ||
    SPOON_AMOUNT_PATTERN.test(trimmed)
  );
}

function parseIngredient(line: string): RecipeFormData['ingredients'][number] {
  const cleaned = stripBullet(line).replace(/[：:]/, ' ');
  const parts = cleaned.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    const amount = parts.slice(1).join(' ');
    if (isLikelyAmount(amount)) {
      return {
        name: parts[0],
        amount,
        groupLabel: '',
        note: '',
      };
    }
  }

  return {
    name: cleaned,
    amount: '',
    groupLabel: '',
    note: '',
  };
}

function parseStep(line: string): RecipeFormData['steps'][number] {
  const cleaned = stripBullet(line);
  const numbered = cleaned.match(STEP_PATTERN);
  const body = cleanLine(numbered?.[1] ?? cleaned);
  return {
    body,
    // 「10分煮る」等の時間表現からタイマーを自動セット（確認フォームで修正可能）
    timerSec: extractPrimaryStepTimer(body)?.seconds,
  };
}

function calculateConfidence(formData: RecipeFormData): ParseConfidence {
  const hasTitle = formData.title.trim().length > 0;
  const hasIngredient = formData.ingredients.some((ingredient) => ingredient.name.trim());
  const hasStep = formData.steps.some((step) => step.body.trim());
  const score = [hasTitle, hasIngredient, hasStep].filter(Boolean).length;
  if (score === 3) return 'high';
  if (score === 2) return 'medium';
  return 'low';
}

export function parseRecipeText(rawText: string): ParsedRecipeText {
  const lines = rawText.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const ingredients: RecipeFormData['ingredients'] = [];
  const steps: RecipeFormData['steps'] = [];
  const descriptionLines: string[] = [];
  const unparsedLines: string[] = [];
  let title = '';
  let servings: number | undefined;
  let cookTimeMin: number | undefined;
  let prepTimeMin: number | undefined;
  let mode: ParseMode = 'unknown';

  for (const line of lines) {
    const section = detectSection(line);
    if (section) {
      mode = section;
      continue;
    }

    const explicitTitle = line.match(TITLE_PATTERN);
    if (explicitTitle) {
      title = explicitTitle[1].trim();
      continue;
    }

    const servingsMatch = line.match(SERVINGS_PATTERN);
    if (servingsMatch) {
      servings = parsePositiveInt(servingsMatch[1]);
      continue;
    }

    const cookTimeMatch = line.match(COOK_TIME_PATTERN);
    if (cookTimeMatch) {
      cookTimeMin = parsePositiveInt(cookTimeMatch[1]);
      continue;
    }

    const prepTimeMatch = line.match(PREP_TIME_PATTERN);
    if (prepTimeMatch) {
      prepTimeMin = parsePositiveInt(prepTimeMatch[1]);
      continue;
    }

    if (!title && mode === 'unknown') {
      title = line.replace(/^#+\s*/, '');
      continue;
    }

    if (mode === 'ingredients') {
      ingredients.push(parseIngredient(line));
      continue;
    }

    if (mode === 'steps') {
      steps.push(parseStep(line));
      continue;
    }

    if (mode === 'description') {
      descriptionLines.push(stripBullet(line));
      continue;
    }

    if (STEP_PATTERN.test(stripBullet(line))) {
      steps.push(parseStep(line));
      mode = 'steps';
      continue;
    }

    const ingredient = parseIngredient(line);
    if (ingredient.amount || isLikelyAmount(line.split(/\s+/).slice(1).join(' '))) {
      ingredients.push(ingredient);
      continue;
    }

    unparsedLines.push(line);
  }

  if (steps.length === 0 && unparsedLines.length > 0) {
    steps.push(...unparsedLines.splice(0).map(parseStep));
  }

  const formData: RecipeFormData = {
    title,
    titleReading: '',
    description: descriptionLines.join('\n').slice(0, 500),
    servings,
    cookTimeMin,
    prepTimeMin,
    ingredients: ingredients.length > 0 ? ingredients : [{ ...EMPTY_INGREDIENT }],
    steps: steps.length > 0 ? steps : [{ ...EMPTY_STEP }],
    tags: [],
  };

  return {
    formData,
    confidence: calculateConfidence(formData),
    unparsedLines,
    normalizedBy: 'parser',
    warnings: unparsedLines.length > 0 ? ['分類できなかった行があります'] : [],
  };
}
