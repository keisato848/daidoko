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
  /** **画面に出す**警告。日本語で、利用者が読んで意味のあるものだけ */
  warnings: string[];
  /**
   * 補正 provider が使えなかった理由。**開発者向けで画面には出さない**
   * （英語の内部メッセージが結果画面の帯に出ていた — 2026-08-23）。
   */
  assistanceFailures?: string[];
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

/**
 * `recipeFormSchema` の上限。**parser の出力は必ずこの範囲に収める。**
 * OCR は紙面の隅（原材料表示・賞味期限）まで拾うので、1 行でも上限を超えると
 * 保存時にそこで詰まる。確認・編集の画面へ渡すのが目的なので、落とさず刈り込む。
 */
const LIMITS = {
  title: 100,
  groupLabel: 30,
  ingredientName: 50,
  amount: 30,
  note: 100,
  stepBody: 500,
  servings: { min: 1, max: 99 },
  minutes: { min: 1, max: 999 },
} as const;

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** 範囲外は「読めなかった」扱いにする（スキーマを通らない値を渡さない）。 */
function inRange(value: number | undefined, min: number, max: number): number | undefined {
  return value !== undefined && value >= min && value <= max ? value : undefined;
}

const EMPTY_INGREDIENT = { name: '', amount: '', groupLabel: '', note: '' };
const EMPTY_STEP = { body: '', timerSec: undefined };

const SECTION_PATTERNS: Record<Exclude<ParseMode, 'unknown'>, RegExp> = {
  ingredients: /^(?:[#\s　]*)(材料|食材|具材|ingredients?)[:：\s　]*$/i,
  steps: /^(?:[#\s　]*)(作り方|つくり方|手順|工程|方法|steps?|directions?)[:：\s　]*$/i,
  description: /^(?:[#\s　]*)(説明|メモ|ポイント|コツ|note|notes?)[:：\s　]*$/i,
};

const STEP_PATTERN = /^(?:\d+|[０-９]+|[①②③④⑤⑥⑦⑧⑨⑩])[\.)．、\s　]+(.+)$/;
const BULLET_PATTERN = /^[・*\-−—]\s*/;
/**
 * 「じゃがいも……中2個」のリーダー（点線）。**レシピ本と食品パッケージの標準的な書式**で、
 * 空白が 1 つも無いため、これを区切りとして扱わないと材料が 1 つも取れない
 * （AQUOS でパッケージ裏を撮って発覚・2026-08-23）。
 *
 * `…` `‥` は区切り専用の文字なので 1 つでも区切りとみなす。
 * 点と中黒は **2 つ以上**のときだけ — 「塩・こしょう」の並列や文末の句点を割らないため。
 */
const LEADER_DOTS_PATTERN = /(?:[…‥]+|[.．]{2,}|[・･]{2,})/;

/**
 * 点 1 つのリーダー。**OCR は点線をピリオド 1 個に潰すことがある**
 * （AQUOS + ML Kit で「じゃがいも(くし形切り).中2個(300g)」— 2026-08-23）。
 *
 * 誤爆が怖いので条件を 2 つ課す:
 * - **行に空白が無いとき**だけ。リーダー書式は空白を使わないので、
 *   「じゃがいも 2.5個」のような空白区切りの行はこちらに来ない
 * - 点の**前が数字でない**こと。小数（「大さじ1.5」）を割らない
 */
function splitOnSingleDot(value: string): { name: string; amount: string } | null {
  if (/\s/.test(value)) return null;
  for (let index = value.length - 1; index > 0; index--) {
    if (value[index] !== '.' && value[index] !== '．') continue;
    if (/\d/.test(value[index - 1])) continue;
    const name = value.slice(0, index).trim();
    const amount = value.slice(index + 1).trim();
    if (name && amount) return { name, amount };
  }
  return null;
}
const TITLE_PATTERN = /^(?:タイトル|レシピ名|name)[:：]\s*(.+)$/i;
const SERVINGS_PATTERN = /(?:^|[:：\s　])(\d+|[０-９]+)\s*(?:人分|人前| servings?)/i;
/** 見出しの末尾に付いた人数。「肉じゃが（2人分）」「肉じゃが(2人分)」「肉じゃが 2人分」。 */
const TITLE_SERVINGS_SUFFIX_PATTERN =
  /\s*[（(]?\s*(\d+|[０-９]+)\s*(?:人分|人前|servings?)\s*[)）]?\s*$/i;
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

/**
 * 見出しに人数が付いていたら分ける。OCR や手書きの見出しは「肉じゃが（2人分）」の形が多く、
 * そのまま料理名にすると人数欄が空のまま料理名に「(2人分)」が残る（Pixel 9a で確認・2026-08-23）。
 * 末尾に付いているときだけ扱い、本文中の人数表記には触らない。
 */
function splitTitleServings(value: string): { title: string; servings: number | undefined } {
  const match = value.match(TITLE_SERVINGS_SUFFIX_PATTERN);
  if (!match || match.index === undefined) return { title: value, servings: undefined };
  return { title: value.slice(0, match.index).trim(), servings: parsePositiveInt(match[1]) };
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function stripBullet(line: string): string {
  return cleanLine(line.replace(BULLET_PATTERN, ''));
}

interface DetectedSection {
  mode: Exclude<ParseMode, 'unknown'>;
  /** 見出しに人数が付いていたとき（「材料(2人前)」）だけ入る */
  servings?: number;
}

/**
 * 見出し行かどうか。**人数が付いた形も見出しとして扱う**（「材料(2人前)」「作り方 4人分」）。
 * 食品パッケージやレシピ本ではこの形が普通で、`材料` だけの行を要求していたため
 * 材料が 1 つも拾えないまま終わっていた（AQUOS で発覚・2026-08-23）。
 */
function detectSection(line: string): DetectedSection | null {
  const split = splitTitleServings(line);
  const head = split.servings === undefined ? line : split.title;
  for (const mode of ['ingredients', 'steps', 'description'] as const) {
    if (SECTION_PATTERNS[mode].test(head)) {
      return split.servings === undefined ? { mode } : { mode, servings: split.servings };
    }
  }
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

  // リーダー（「じゃがいも……中2個」）は空白より先に見る。空白が無い書式なので、
  // ここで分けないと行まるごとが材料名になる
  const leader = cleaned.split(LEADER_DOTS_PATTERN).filter(Boolean);
  if (leader.length >= 2) {
    const name = leader[0].trim();
    const amount = leader.slice(1).join(' ').trim();
    if (name && amount) {
      return { name, amount, groupLabel: '', note: '' };
    }
  }

  const singleDot = splitOnSingleDot(cleaned);
  if (singleDot) {
    return { ...singleDot, groupLabel: '', note: '' };
  }

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
      mode = section.mode;
      if (section.servings !== undefined) servings = section.servings;
      continue;
    }

    const explicitTitle = line.match(TITLE_PATTERN);
    if (explicitTitle) {
      const split = splitTitleServings(explicitTitle[1].trim());
      title = split.title;
      servings = split.servings ?? servings;
      continue;
    }

    const servingsMatch = line.match(SERVINGS_PATTERN);
    if (servingsMatch) {
      // 「肉じゃが 2人分」のように見出しと人数が 1 行のとき、人数だけ拾って見出しを
      // 落とさない。「材料: 2人分」のようなラベル付きは見出しにしない
      const split = !title && mode === 'unknown' ? splitTitleServings(line) : null;
      if (split && split.title && !/[:：]$/.test(split.title)) {
        title = split.title;
        servings = split.servings;
        continue;
      }
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
      const split = splitTitleServings(line.replace(/^#+\s*/, ''));
      title = split.title;
      servings = split.servings ?? servings;
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
    title: clamp(title, LIMITS.title),
    titleReading: '',
    description: descriptionLines.join('\n').slice(0, 500),
    servings: inRange(servings, LIMITS.servings.min, LIMITS.servings.max),
    cookTimeMin: inRange(cookTimeMin, LIMITS.minutes.min, LIMITS.minutes.max),
    prepTimeMin: inRange(prepTimeMin, LIMITS.minutes.min, LIMITS.minutes.max),
    ingredients:
      ingredients.length > 0
        ? ingredients.map((ingredient) => ({
            name: clamp(ingredient.name, LIMITS.ingredientName),
            amount: clamp(ingredient.amount, LIMITS.amount),
            groupLabel: clamp(ingredient.groupLabel, LIMITS.groupLabel),
            note: clamp(ingredient.note, LIMITS.note),
          }))
        : [{ ...EMPTY_INGREDIENT }],
    steps:
      steps.length > 0
        ? steps.map((step) => ({ ...step, body: clamp(step.body, LIMITS.stepBody) }))
        : [{ ...EMPTY_STEP }],
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
