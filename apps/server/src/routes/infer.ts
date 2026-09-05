/**
 * POST /api/v1/infer/photo — dish-photo → recipe draft inference (Vision LLM).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { runPhotoInferAgent } from '../agents/photo-infer.agent.js';
import { resolveThinkingBudget } from '../lib/thinking-budget.js';
import {
  GeminiVisionRecipeProvider,
  VisionConfigError,
  type VisionRecipeProvider,
} from '../lib/vision-recipe.js';
import {
  GeminiMealVisionProvider,
  MealVisionConfigError,
  MealVisionRequestError,
  sanitizeMealRaw,
  type MealVisionProvider,
} from '../lib/meal-vision.js';
import {
  GeminiReceiptVisionProvider,
  ReceiptVisionConfigError,
  ReceiptVisionRequestError,
  sanitizeReceiptRaw,
  type ReceiptVisionProvider,
} from '../lib/receipt-vision.js';
import {
  FridgeVisionConfigError,
  FridgeVisionRequestError,
  GeminiFridgeVisionProvider,
  MAX_FRIDGE_IMAGES,
  sanitizeFridgeItems,
  type FridgeVisionProvider,
} from '../lib/fridge-vision.js';
import {
  GeminiRecipeRefineProvider,
  RefineConfigError,
  type RecipeRefineProvider,
  type RefineRecipeSnapshot,
} from '../lib/recipe-refine.js';
import { runRecipeRefineAgent } from '../agents/recipe-refine.agent.js';
import { checkRateLimit, COVER_POOL } from '../lib/rate-limit.js';
import { parseOutputLocale, parseUnitSystem } from '../lib/output-locale.js';
import {
  ConsultConfigError,
  GeminiRecipeConsultProvider,
  MAX_CONSULT_IMAGES,
  MAX_CONSULT_MESSAGES,
  type ConsultDraft,
  type RecipeConsultProvider,
} from '../lib/recipe-consult.js';
import { runRecipeConsultAgent } from '../agents/recipe-consult.agent.js';
import {
  GeminiRecipePageProvider,
  MAX_RECIPE_PAGE_IMAGES,
  RecipePageConfigError,
  type RecipePageProvider,
} from '../lib/recipe-page.js';
import { runRecipePageAgent } from '../agents/recipe-page.agent.js';
import {
  GeminiMenuArrangeProvider,
  MAX_MENU_CANDIDATES,
  MAX_MENU_DAYS,
  MenuArrangeConfigError,
  type MenuArrangeProvider,
} from '../lib/menu-arrange.js';
import { runMenuArrangeAgent } from '../agents/menu-arrange.agent.js';
import {
  GeminiMenuRecipesProvider,
  MAX_MENU_RECIPES_DAYS,
  MAX_MENU_RECIPES_PANTRY,
  MAX_MENU_RECIPES_PREFERENCES,
  MAX_MENU_RECIPES_TITLES,
  MenuRecipesConfigError,
  type MenuRecipesProvider,
} from '../lib/menu-recipes.js';
import { runMenuRecipesAgent } from '../agents/menu-recipes.agent.js';
import { peekMonthlyQuota, recordMonthlyUse } from '../lib/quota-store.js';
import {
  CoverImageConfigError,
  GeminiCoverImageProvider,
  MAX_COVER_INGREDIENTS,
  MAX_COVER_TAGS,
  type CoverImageProvider,
} from '../lib/cover-image.js';
import { runCoverImageAgent } from '../agents/cover-image.agent.js';

const inferRouter = new Hono();

// base64 of a ~1024px JPEG is well under this; guard against oversized payloads.
// 契約の正は shared `MAX_INFER_IMAGE_BASE64_LENGTH`（同値の写し。突合は
// __tests__/shared-parity.test.ts — サーバーは実行時に shared を取り込まない方針）
export const MAX_IMAGE_BASE64_LENGTH = 8_000_000; // ~6 MB decoded

const inferPhotoSchema = z.object({
  imageBase64: z.string().min(1, '画像が空です').max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  context: z.string().max(1000, '補足テキストが長すぎます').optional(),
  /**
   * 端末の言語。**AI が返すレシピの言語**を決める。省略時は ja。
   * これが無いと、英語の画面に日本語のレシピが返ってくる。
   */
  locale: z.enum(['ja', 'en']).optional(),
  /**
   * 単位系。**AI が書く分量と温度**を決める。省略時は metric。
   * 言語とは別（英国の利用者は英語だがメートル法）。
   * 米国の利用者に「180度」を 180°F と読まれると料理が失敗する。
   */
  unitSystem: z.enum(['metric', 'imperial']).optional(),
});

// Lazily construct the provider so the route module imports without an API key
// (e.g. in tests). Tests can inject a provider via setInferProviderForTesting.
let providerOverride: VisionRecipeProvider | null = null;

export function setInferProviderForTesting(provider: VisionRecipeProvider | null): void {
  providerOverride = provider;
}

function resolveProvider(): VisionRecipeProvider {
  if (providerOverride) return providerOverride;
  return new GeminiVisionRecipeProvider();
}

inferRouter.post('/photo', zValidator('json', inferPhotoSchema), async (c) => {
  // Per-client rate limit (best-effort, in-memory). Identify by forwarded IP.
  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  const rate = checkRateLimit(clientId);
  if (!rate.allowed) {
    const message =
      rate.scope === 'global'
        ? '本日の利用上限に達しました。時間をおいてお試しください。'
        : '本日の利用上限に達しました。';
    return c.json({
      ok: false,
      error: { code: 'RATE_LIMITED', message, retryable: false },
    });
  }

  const { imageBase64, mimeType, context, locale, unitSystem } = c.req.valid('json');

  let provider: VisionRecipeProvider;
  try {
    provider = resolveProvider();
  } catch (err) {
    if (err instanceof VisionConfigError) {
      return c.json({
        ok: false,
        error: { code: 'AI_API_UNAVAILABLE', message: 'AI 推論が利用できません', retryable: false },
      });
    }
    throw err;
  }

  // 思考オフは**ルート側**で効かせる。評価ハーネスは provider を直呼びするので
  // ここを通らず、A/B の「思考あり」基準がそのまま残る（`scripts/vision-eval.ts`）。
  const thinkingBudget = resolveThinkingBudget();

  const result = await runPhotoInferAgent(
    {
      imageBase64,
      mimeType,
      ...(context !== undefined && { context }),
      outputLocale: parseOutputLocale(locale),
      unitSystem: parseUnitSystem(unitSystem),
      ...(thinkingBudget !== undefined && { thinkingBudget }),
    },
    provider,
  );
  // Always 200 — errors are in the response body (AgentResult pattern).
  return c.json(result);
});

// ─── POST /meal — meal photo → consumed-ingredient estimate (experimental) ────

const inferMealSchema = z.object({
  imageBase64: z.string().min(1, '画像が空です').max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** 端末の言語。AI が返す文言の言語を決める。省略時は ja。 */
  locale: z.enum(['ja', 'en']).optional(),
  /**
   * 単位系。**AI が書く分量と温度**を決める。省略時は metric。
   * 言語とは別（英国の利用者は英語だがメートル法）。
   * 米国の利用者に「180度」を 180°F と読まれると料理が失敗する。
   */
  unitSystem: z.enum(['metric', 'imperial']).optional(),
});

let mealProviderOverride: MealVisionProvider | null = null;

export function setMealProviderForTesting(provider: MealVisionProvider | null): void {
  mealProviderOverride = provider;
}

function resolveMealProvider(): MealVisionProvider {
  return mealProviderOverride ?? new GeminiMealVisionProvider();
}

/**
 * 紙面（レシピ本・パッケージ・手書きメモ）に**書かれている**レシピを読み取る。
 *
 * `/photo`（料理写真から推測する）とは**タスクが正反対**なので分けている。
 * あちらは見えないものを補い、こちらは書いてあるものだけを写す。
 * プロンプトの違いは `lib/recipe-page.ts` を参照。
 *
 * **最初から複数枚**を受ける。紙面は表に料理名・裏に材料と作り方のように分かれるのが
 * 普通で、1 枚では完結しないため（`docs/レシピ推論の評価設計.md` §10）。
 */
const inferRecipePageSchema = z.object({
  images: z
    .array(
      z.object({
        imageBase64: z
          .string()
          .min(1, '画像が空です')
          .max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      }),
    )
    .min(1, '画像がありません')
    .max(MAX_RECIPE_PAGE_IMAGES, `画像は ${MAX_RECIPE_PAGE_IMAGES} 枚までです`),
  context: z.string().max(1000, '補足テキストが長すぎます').optional(),
  locale: z.enum(['ja', 'en']).optional(),
  unitSystem: z.enum(['metric', 'imperial']).optional(),
});

let recipePageProviderOverride: RecipePageProvider | null = null;

export function setRecipePageProviderForTesting(provider: RecipePageProvider | null): void {
  recipePageProviderOverride = provider;
}

inferRouter.post('/recipe-page', zValidator('json', inferRecipePageSchema), async (c) => {
  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  const rate = checkRateLimit(clientId);
  if (!rate.allowed) {
    const message =
      rate.scope === 'global'
        ? '本日の利用上限に達しました。時間をおいてお試しください。'
        : '本日の利用上限に達しました。';
    return c.json({ ok: false, error: { code: 'RATE_LIMITED', message, retryable: false } });
  }

  const { images, context, locale, unitSystem } = c.req.valid('json');

  let provider: RecipePageProvider;
  try {
    provider = recipePageProviderOverride ?? new GeminiRecipePageProvider();
  } catch (err) {
    if (err instanceof RecipePageConfigError) {
      return c.json({
        ok: false,
        error: {
          code: 'AI_API_UNAVAILABLE',
          message: 'AI 読み取りが利用できません',
          retryable: false,
        },
      });
    }
    throw err;
  }

  const result = await runRecipePageAgent(
    {
      images,
      ...(context !== undefined && { context }),
      outputLocale: parseOutputLocale(locale),
      unitSystem: parseUnitSystem(unitSystem),
    },
    provider,
  );
  // Always 200 — errors are in the response body (AgentResult pattern).
  return c.json(result);
});

inferRouter.post('/meal', zValidator('json', inferMealSchema), async (c) => {
  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  if (!checkRateLimit(clientId).allowed) {
    return c.json({
      ok: false,
      error: { code: 'RATE_LIMITED', message: '本日の利用上限に達しました。', retryable: false },
    });
  }

  const { imageBase64, mimeType, locale } = c.req.valid('json');

  let provider: MealVisionProvider;
  try {
    provider = resolveMealProvider();
  } catch (err) {
    if (err instanceof MealVisionConfigError) {
      return c.json({
        ok: false,
        error: { code: 'AI_API_UNAVAILABLE', message: 'AI 推論が利用できません', retryable: false },
      });
    }
    throw err;
  }

  try {
    const data = await provider.infer({
      imageBase64,
      mimeType,
      outputLocale: parseOutputLocale(locale),
    });
    // 生出力を素通ししない（水平展開規約②）。カテゴリ語の材料はここで落ちる
    return c.json({ ok: true, data: sanitizeMealRaw(data) });
  } catch (err) {
    const retryable = err instanceof MealVisionRequestError;
    return c.json({
      ok: false,
      error: {
        code: 'AI_INFER_FAILED',
        message: '推定に失敗しました。時間をおいてお試しください。',
        retryable,
      },
    });
  }
});

// ─── POST /receipt — receipt photo → grocery item names (Vision) ─────────────

/** レシート1枚の OCR テキストの上限。長いレシートでも数千字に収まる。 */
const MAX_OCR_TEXT_LENGTH = 20_000;

const receiptCommonSchema = {
  /** 端末の言語。AI が返す文言の言語を決める。省略時は ja。 */
  locale: z.enum(['ja', 'en']).optional(),
  /**
   * 単位系。**AI が書く分量と温度**を決める。省略時は metric。
   * 言語とは別（英国の利用者は英語だがメートル法）。
   * 米国の利用者に「180度」を 180°F と読まれると料理が失敗する。
   */
  unitSystem: z.enum(['metric', 'imperial']).optional(),
};

/**
 * 入力は2種類。端末内 OCR が読めたときは `ocrText`、読めなかったときは画像。
 * **画像側の形は変えない** — 旧バージョンのアプリが送ってくる（`docs/在庫・レシート設計レビュー.md` §3.4）。
 */
const inferReceiptSchema = z.union([
  z.object({
    imageBase64: z
      .string()
      .min(1, '画像が空です')
      .max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    ...receiptCommonSchema,
  }),
  z.object({
    ocrText: z.string().min(1, 'テキストが空です').max(MAX_OCR_TEXT_LENGTH, 'テキストが長すぎます'),
    ...receiptCommonSchema,
  }),
]);

let receiptProviderOverride: ReceiptVisionProvider | null = null;

export function setReceiptProviderForTesting(provider: ReceiptVisionProvider | null): void {
  receiptProviderOverride = provider;
}

function resolveReceiptProvider(): ReceiptVisionProvider {
  return receiptProviderOverride ?? new GeminiReceiptVisionProvider();
}

inferRouter.post('/receipt', zValidator('json', inferReceiptSchema), async (c) => {
  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  if (!checkRateLimit(clientId).allowed) {
    return c.json({
      ok: false,
      error: { code: 'RATE_LIMITED', message: '本日の利用上限に達しました。', retryable: false },
    });
  }

  const input = c.req.valid('json');

  let provider: ReceiptVisionProvider;
  try {
    provider = resolveReceiptProvider();
  } catch (err) {
    if (err instanceof ReceiptVisionConfigError) {
      return c.json({
        ok: false,
        error: { code: 'AI_API_UNAVAILABLE', message: 'AI 推論が利用できません', retryable: false },
      });
    }
    throw err;
  }

  try {
    const outputLocale = parseOutputLocale(input.locale);
    const data = await provider.infer(
      'ocrText' in input
        ? { ocrText: input.ocrText, outputLocale }
        : { imageBase64: input.imageBase64, mimeType: input.mimeType, outputLocale },
    );
    // 生出力を素通ししない（水平展開規約②）。カテゴリ語・売り場名の品目はここで落ちる
    return c.json({ ok: true, data: sanitizeReceiptRaw(data) });
  } catch (err) {
    const retryable = err instanceof ReceiptVisionRequestError;
    return c.json({
      ok: false,
      error: {
        code: 'AI_INFER_FAILED',
        message: '読み取りに失敗しました。時間をおいてお試しください。',
        retryable,
      },
    });
  }
});

// ─── POST /fridge — fridge photo → ingredient names (docs/冷蔵庫写真設計.md) ────

/**
 * 契約の正は `packages/shared/src/types/fridge.ts`（サーバーは実行時に shared を
 * 取り込まない方針のため、ここは同じ形の写し。片方だけ直さないこと）。
 * 品名と confidence だけを返す — 数量・分量の欄は契約上存在しない。
 */
const inferFridgeSchema = z.object({
  images: z
    .array(
      z.object({
        // 上限は契約の正（shared `MAX_FRIDGE_IMAGE_BASE64_LENGTH`）と同値。
        // 実機のカメラ写真は超え得るので、クライアントは送信前に必ず縮小する
        imageBase64: z
          .string()
          .min(1, '画像が空です')
          .max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      }),
    )
    .min(1, '画像がありません')
    .max(MAX_FRIDGE_IMAGES, `画像は ${MAX_FRIDGE_IMAGES} 枚までです`),
  locale: z.enum(['ja', 'en']).optional(),
  // unitSystem は受けない — 分量を出力しない推論への単位系指示は
  // 「分量を書け」という圧力になるだけ（/menu と同じ意図的な差分）
});

let fridgeProviderOverride: FridgeVisionProvider | null = null;

export function setFridgeProviderForTesting(provider: FridgeVisionProvider | null): void {
  fridgeProviderOverride = provider;
}

function resolveFridgeProvider(): FridgeVisionProvider {
  return fridgeProviderOverride ?? new GeminiFridgeVisionProvider();
}

inferRouter.post('/fridge', zValidator('json', inferFridgeSchema), async (c) => {
  // /infer/menu-recipes と同じ認可・枠の作法（§10.10.1 の順序が本質）。
  // レシート読み取り（無料・ゲートなし）とは違い、冷蔵庫写真は**月次無料枠を 1 消費する**
  // （docs/冷蔵庫写真設計.md §5 — レシートは購買の記帳、こちらは能動的な AI 機能）。
  const deviceId = c.req.header('x-device-id');
  if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) {
    return c.json({
      ok: false,
      error: { code: 'UNKNOWN', message: '端末IDが不正です', retryable: false },
    });
  }

  const quotaSource = c.req.header('x-quota-source');
  const bypassMonthlyQuota = quotaSource === 'token' || quotaSource === 'premium';

  // 月次枠（無料のローカル読み）が先。checkRateLimit は許可時に即カウンタを
  // 増やすため、枠切れの連打が共有プールを消費してしまう（/menu と同じ順序）
  if (!bypassMonthlyQuota && !peekMonthlyQuota(deviceId, QUOTA_CATEGORY, monthlyFreeLimit())) {
    return c.json({
      ok: false,
      error: {
        code: 'FREE_QUOTA_EXCEEDED',
        message: '今月の無料枠を使い切りました。',
        retryable: false,
      },
    });
  }

  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  // 専用プールは作らない。RECIPE_POOL（INFER_*）を共有する（視覚推論 1 回ぶん）
  const rate = checkRateLimit(clientId);
  if (!rate.allowed) {
    return c.json({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message:
          rate.scope === 'global'
            ? '本日の利用上限に達しました。時間をおいてお試しください。'
            : '本日の利用上限に達しました。',
        retryable: false,
      },
    });
  }

  let provider: FridgeVisionProvider;
  try {
    provider = resolveFridgeProvider();
  } catch (err) {
    if (err instanceof FridgeVisionConfigError) {
      return c.json({
        ok: false,
        error: { code: 'AI_API_UNAVAILABLE', message: 'AI 推論が利用できません', retryable: false },
      });
    }
    throw err;
  }

  const { images, locale } = c.req.valid('json');

  try {
    const raw = await provider.infer({ images, outputLocale: parseOutputLocale(locale) });
    // 消費は provider 成功時のみ。枠を飛ばした場合（token/premium）は記録しない。
    // 空の items でも消費する — 推論は実行されており、コストは発生している
    if (!bypassMonthlyQuota) recordMonthlyUse(deviceId, QUOTA_CATEGORY);
    return c.json({ ok: true, data: { items: sanitizeFridgeItems(raw) } });
  } catch (err) {
    const retryable = err instanceof FridgeVisionRequestError;
    // 画像・生出力はログに書かない（/photo と同じ — 冷蔵庫は生活そのもの）
    return c.json({
      ok: false,
      error: {
        code: 'AI_INFER_FAILED',
        message: '読み取りに失敗しました。時間をおいてお試しください。',
        retryable,
      },
    });
  }
});

// ─── POST /refine — existing recipe + feedback (+ optional photos) → adjusted ──

const refineIngredientSchema = z.object({
  groupLabel: z.string().max(30).optional(),
  name: z.string().min(1).max(50),
  amount: z.string().max(30).optional(),
  note: z.string().max(100).optional(),
});

const refineImageSchema = z.object({
  imageBase64: z.string().min(1, '画像が空です').max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  // cooked = 家で作った結果（現状） / target = 店の料理（目指す状態）
  role: z.enum(['cooked', 'target']),
});

const inferRefineSchema = z.object({
  recipe: z.object({
    title: z.string().min(1).max(100),
    servings: z.number().int().min(1).max(99).optional(),
    cookTimeMin: z.number().int().min(1).max(999).optional(),
    description: z.string().max(500).optional(),
    ingredients: z.array(refineIngredientSchema).min(1, '材料がありません').max(100),
    steps: z
      .array(z.object({ body: z.string().min(1).max(500) }))
      .min(1, '手順がありません')
      .max(50),
    tags: z.array(z.string().max(30)).max(10).optional(),
  }),
  feedback: z.string().min(1, '感想が空です').max(1000, '感想が長すぎます'),
  // 任意。cooked / target の 2 枚まで（設計上それ以上は意味を持たない）
  images: z.array(refineImageSchema).max(2).optional(),
  /** 端末の言語。AI が返す文言の言語を決める。省略時は ja。 */
  locale: z.enum(['ja', 'en']).optional(),
  /**
   * 単位系。**AI が書く分量と温度**を決める。省略時は metric。
   * 言語とは別（英国の利用者は英語だがメートル法）。
   * 米国の利用者に「180度」を 180°F と読まれると料理が失敗する。
   */
  unitSystem: z.enum(['metric', 'imperial']).optional(),
});

let refineProviderOverride: RecipeRefineProvider | null = null;

export function setRefineProviderForTesting(provider: RecipeRefineProvider | null): void {
  refineProviderOverride = provider;
}

function resolveRefineProvider(): RecipeRefineProvider {
  return refineProviderOverride ?? new GeminiRecipeRefineProvider();
}

inferRouter.post('/refine', zValidator('json', inferRefineSchema), async (c) => {
  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  // 写真レシピと同じ枠を消費する。AI 呼び出しであることに変わりはなく、
  // 別枠にすると上限管理が二重になる（docs/お店の味を再現設計.md §5）
  const rate = checkRateLimit(clientId);
  if (!rate.allowed) {
    return c.json({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message:
          rate.scope === 'global'
            ? '本日の利用上限に達しました。時間をおいてお試しください。'
            : '本日の利用上限に達しました。',
        retryable: false,
      },
    });
  }

  const { recipe, feedback, images, locale, unitSystem } = c.req.valid('json');

  let provider: RecipeRefineProvider;
  try {
    provider = resolveRefineProvider();
  } catch (err) {
    if (err instanceof RefineConfigError) {
      return c.json({
        ok: false,
        error: { code: 'AI_API_UNAVAILABLE', message: 'AI 推論が利用できません', retryable: false },
      });
    }
    throw err;
  }

  // exactOptionalPropertyTypes: Zod の .optional() は `T | undefined` を作るので、
  // 省略可フィールドはスプレッドで組み立てる（リポジトリの既定の書き方）
  const snapshot: RefineRecipeSnapshot = {
    title: recipe.title,
    ...(recipe.servings !== undefined && { servings: recipe.servings }),
    ...(recipe.cookTimeMin !== undefined && { cookTimeMin: recipe.cookTimeMin }),
    ...(recipe.description !== undefined && { description: recipe.description }),
    ingredients: recipe.ingredients.map((ing) => ({
      name: ing.name,
      ...(ing.groupLabel !== undefined && { groupLabel: ing.groupLabel }),
      ...(ing.amount !== undefined && { amount: ing.amount }),
      ...(ing.note !== undefined && { note: ing.note }),
    })),
    steps: recipe.steps,
    ...(recipe.tags !== undefined && { tags: recipe.tags }),
  };

  const result = await runRecipeRefineAgent(
    {
      recipe: snapshot,
      feedback,
      ...(images !== undefined && { images }),
      outputLocale: parseOutputLocale(locale),
      unitSystem: parseUnitSystem(unitSystem),
    },
    provider,
  );
  // Always 200 — errors are in the response body (AgentResult pattern).
  return c.json(result);
});

// ─── 相談してレシピを作る ────────────────────────────────────────────────────

const consultIngredientSchema = z.object({
  groupLabel: z.string().max(30).optional(),
  name: z.string().min(1).max(50),
  amount: z.string().max(30).optional(),
  note: z.string().max(100).optional(),
});

const consultDraftSchema = z.object({
  title: z.string().min(1).max(100),
  titleReading: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  servings: z.number().int().min(1).max(99).optional(),
  cookTimeMin: z.number().int().min(1).max(999).optional(),
  ingredients: z.array(consultIngredientSchema).max(100),
  steps: z.array(z.object({ body: z.string().min(1).max(500) })).max(50),
  tags: z.array(z.string().max(30)).max(10).optional(),
});

const inferConsultSchema = z.object({
  /** 会話。最後がいちばん新しい発言。上限を超えるぶんはサーバーで頭から落とす */
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().min(1, '発言が空です').max(2000, '発言が長すぎます'),
        /**
         * その発言に添えた写真（冷蔵庫の中身・食材・参考にしたい料理）。**任意**。
         * 何枚まで実際にモデルへ載せるかは `pickRecentImages()` が新しい方から決める。
         */
        images: z
          .array(
            z.object({
              imageBase64: z
                .string()
                .min(1, '画像が空です')
                .max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
              mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
            }),
          )
          .max(MAX_CONSULT_IMAGES)
          .optional(),
      }),
    )
    .min(1, '相談する内容がありません')
    .max(MAX_CONSULT_MESSAGES * 2),
  /** いま手元にある下書き（2 回目以降） */
  draft: consultDraftSchema.nullish(),
  /** 手元の在庫。**任意** — 利用者が「在庫を考慮する」を選んだときだけ送られる */
  pantry: z.array(z.string().min(1).max(50)).max(200).optional(),
  locale: z.enum(['ja', 'en']).optional(),
  unitSystem: z.enum(['metric', 'imperial']).optional(),
});

let consultProviderOverride: RecipeConsultProvider | null = null;

export function setConsultProviderForTesting(provider: RecipeConsultProvider | null): void {
  consultProviderOverride = provider;
}

function resolveConsultProvider(): RecipeConsultProvider {
  return consultProviderOverride ?? new GeminiRecipeConsultProvider();
}

inferRouter.post('/consult', zValidator('json', inferConsultSchema), async (c) => {
  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  // 写真レシピと同じ枠を消費する（AI 呼び出しであることに変わりはない）
  const rate = checkRateLimit(clientId);
  if (!rate.allowed) {
    return c.json({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message:
          rate.scope === 'global'
            ? '本日の利用上限に達しました。時間をおいてお試しください。'
            : '本日の利用上限に達しました。',
        retryable: false,
      },
    });
  }

  const { messages, draft, pantry, locale, unitSystem } = c.req.valid('json');

  let provider: RecipeConsultProvider;
  try {
    provider = resolveConsultProvider();
  } catch (err) {
    if (err instanceof ConsultConfigError) {
      return c.json({
        ok: false,
        error: { code: 'AI_API_UNAVAILABLE', message: 'AI 推論が利用できません', retryable: false },
      });
    }
    throw err;
  }

  const snapshot: ConsultDraft | null = draft
    ? {
        title: draft.title,
        ...(draft.titleReading !== undefined && { titleReading: draft.titleReading }),
        ...(draft.description !== undefined && { description: draft.description }),
        ...(draft.servings !== undefined && { servings: draft.servings }),
        ...(draft.cookTimeMin !== undefined && { cookTimeMin: draft.cookTimeMin }),
        ingredients: draft.ingredients.map((ing) => ({
          name: ing.name,
          ...(ing.groupLabel !== undefined && { groupLabel: ing.groupLabel }),
          ...(ing.amount !== undefined && { amount: ing.amount }),
          ...(ing.note !== undefined && { note: ing.note }),
        })),
        steps: draft.steps,
        ...(draft.tags !== undefined && { tags: draft.tags }),
      }
    : null;

  const result = await runRecipeConsultAgent(
    {
      // exactOptionalPropertyTypes: images は「無い」と「undefined」を区別する
      messages: messages.map((message) => ({
        role: message.role,
        text: message.text,
        ...(message.images !== undefined && { images: message.images }),
      })),
      draft: snapshot,
      ...(pantry !== undefined && { pantry }),
      outputLocale: parseOutputLocale(locale),
      unitSystem: parseUnitSystem(unitSystem),
    },
    provider,
  );
  // Always 200 — errors are in the response body (AgentResult pattern).
  return c.json(result);
});

// ─── 献立の並べ替え（M2・docs/買い物リスト・在庫設計.md §10.10） ───────────────

const menuCandidateSchema = z.object({
  /** 端末ローカルの recipes.id。サーバーは解釈せず echo するだけ */
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(100),
  cookTimeMin: z.number().int().min(1).max(999).optional(),
  /** カバー率（%）。整数 0..100 — 小数で渡すと why に小数が漏れる余地を作るだけ */
  coveragePct: z.number().int().min(0).max(100),
  /** 不足材料の名前だけ。数量は契約上渡さない */
  missing: z.array(z.string().min(1).max(50)).max(20),
});

const inferMenuSchema = z.object({
  candidates: z.array(menuCandidateSchema).min(1).max(MAX_MENU_CANDIDATES),
  pantry: z.array(z.string().min(1).max(50)).max(200), // 品名だけ（consult と同じ上限）
  recentTitles: z.array(z.string().min(1).max(100)).max(50).optional(),
  days: z.number().int().min(1).max(MAX_MENU_DAYS), // UI の 2/3/5/7 を焼き込まない
  locale: z.enum(['ja', 'en']).optional(),
  // unitSystem は受けない（§10.5 — 分量を出力しない推論への単位系指示は
  // 「分量を書け」という圧力になるだけ。他ルートとの意図的な差分）
});

let menuProviderOverride: MenuArrangeProvider | null = null;

export function setMenuProviderForTesting(provider: MenuArrangeProvider | null): void {
  menuProviderOverride = provider;
}

function resolveMenuProvider(): MenuArrangeProvider {
  return menuProviderOverride ?? new GeminiMenuArrangeProvider();
}

/** `x-device-id` の書式チェックだけ行う（乱数のインストール UUID・個人情報ではない）。 */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** 月次無料枠の N。既定 5（2026-08-28 利用者決定）。0 = 枠管理を無効化。 */
function monthlyFreeLimit(): number {
  const raw = process.env['INFER_MONTHLY_FREE_LIMIT'];
  if (raw === undefined || raw.trim() === '') return 5;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 5;
}

/** 全体枠のカテゴリ。将来 infer 全体で 1 本にする方針のため最初から 'infer'。 */
const QUOTA_CATEGORY = 'infer';

inferRouter.post('/menu', zValidator('json', inferMenuSchema), async (c) => {
  const deviceId = c.req.header('x-device-id');
  if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) {
    return c.json({
      ok: false,
      error: { code: 'UNKNOWN', message: '端末IDが不正です', retryable: false },
    });
  }

  // 'token' | 'premium' のときだけ月次枠チェックを飛ばす。未知の値（typo 等）は
  // 無視して通常判定に落とす — フェイルオープンにしない
  const quotaSource = c.req.header('x-quota-source');
  const bypassMonthlyQuota = quotaSource === 'token' || quotaSource === 'premium';

  // 月次枠（無料のローカル読み）が先。checkRateLimit は許可時に即カウンタを
  // 増やすため、枠切れの連打が共有プールを消費してしまう（順序が本質・§10.10.1）
  if (!bypassMonthlyQuota && !peekMonthlyQuota(deviceId, QUOTA_CATEGORY, monthlyFreeLimit())) {
    return c.json({
      ok: false,
      error: {
        code: 'FREE_QUOTA_EXCEEDED',
        message: '今月の無料枠を使い切りました。',
        retryable: false,
      },
    });
  }

  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  // menu 専用のプールは作らない。RECIPE_POOL（INFER_*）を共有する（§10.10.6-a）
  const rate = checkRateLimit(clientId);
  if (!rate.allowed) {
    return c.json({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message:
          rate.scope === 'global'
            ? '本日の利用上限に達しました。時間をおいてお試しください。'
            : '本日の利用上限に達しました。',
        retryable: false,
      },
    });
  }

  let provider: MenuArrangeProvider;
  try {
    provider = resolveMenuProvider();
  } catch (err) {
    if (err instanceof MenuArrangeConfigError) {
      return c.json({
        ok: false,
        error: { code: 'AI_API_UNAVAILABLE', message: 'AI 推論が利用できません', retryable: false },
      });
    }
    throw err;
  }

  const { candidates, pantry, recentTitles, days, locale } = c.req.valid('json');
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  // exactOptionalPropertyTypes: zod の .optional() は `T | undefined` を作るので、
  // 省略可フィールドはスプレッドで組み立てる（リポジトリの既定の書き方）
  const normalizedCandidates = candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    ...(candidate.cookTimeMin !== undefined && { cookTimeMin: candidate.cookTimeMin }),
    coveragePct: candidate.coveragePct,
    missing: candidate.missing,
  }));

  const result = await runMenuArrangeAgent(
    {
      candidates: normalizedCandidates,
      pantry,
      ...(recentTitles !== undefined && { recentTitles }),
      days,
      outputLocale: parseOutputLocale(locale),
    },
    candidateIds,
    provider,
  );

  // 消費は provider 成功時のみ。枠を飛ばした場合（token/premium）は記録しない
  if (result.ok && !bypassMonthlyQuota) {
    recordMonthlyUse(deviceId, QUOTA_CATEGORY);
  }

  // Always 200 — errors are in the response body (AgentResult pattern).
  return c.json(result);
});

// ─── 献立の不足分レシピの一括生成（M3・docs/買い物リスト・在庫設計.md §10.12） ──

/**
 * 契約の正は `packages/shared/src/types/menu-recipes.ts`（サーバーは実行時に
 * shared を取り込まない方針のため、ここは同じ形の写し。片方だけ直さないこと）。
 */
const inferMenuRecipesSchema = z.object({
  days: z.number().int().min(1).max(MAX_MENU_RECIPES_DAYS),
  // 献立の時間帯（v19・§10.13）。**省略 = 夕（旧クライアント互換）**。
  // プロンプトの出し分けは lib/menu-recipes.ts の buildMenuRecipesSystemPrompt
  mealTime: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
  existingTitles: z.array(z.string().min(1).max(100)).max(MAX_MENU_RECIPES_TITLES),
  pantry: z.array(z.string().min(1).max(50)).max(MAX_MENU_RECIPES_PANTRY),
  preferences: z.string().max(MAX_MENU_RECIPES_PREFERENCES).optional(),
  locale: z.enum(['ja', 'en']).optional(),
  // 分量を書かせる推論なので consult と同様 unitSystem を受ける（/menu との意図的な差分）
  unitSystem: z.enum(['metric', 'imperial']).optional(),
});

let menuRecipesProviderOverride: MenuRecipesProvider | null = null;

export function setMenuRecipesProviderForTesting(provider: MenuRecipesProvider | null): void {
  menuRecipesProviderOverride = provider;
}

function resolveMenuRecipesProvider(): MenuRecipesProvider {
  return menuRecipesProviderOverride ?? new GeminiMenuRecipesProvider();
}

inferRouter.post('/menu-recipes', zValidator('json', inferMenuRecipesSchema), async (c) => {
  // /infer/menu と同じ認可・枠の作法（§10.10.1 の順序が本質）。
  const deviceId = c.req.header('x-device-id');
  if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) {
    return c.json({
      ok: false,
      error: { code: 'UNKNOWN', message: '端末IDが不正です', retryable: false },
    });
  }

  const quotaSource = c.req.header('x-quota-source');
  const bypassMonthlyQuota = quotaSource === 'token' || quotaSource === 'premium';

  // 月次枠（無料のローカル読み）が先。checkRateLimit は許可時に即カウンタを
  // 増やすため、枠切れの連打が共有プールを消費してしまう（/menu と同じ順序）
  if (!bypassMonthlyQuota && !peekMonthlyQuota(deviceId, QUOTA_CATEGORY, monthlyFreeLimit())) {
    return c.json({
      ok: false,
      error: {
        code: 'FREE_QUOTA_EXCEEDED',
        message: '今月の無料枠を使い切りました。',
        retryable: false,
      },
    });
  }

  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  // 専用プールは作らない。RECIPE_POOL（INFER_*）を共有する（§10.10.6-a と同じ判断 —
  // n 品でも呼び出しは 1 回なので、テキスト推論 1 回ぶんとして数えてよい）
  const rate = checkRateLimit(clientId);
  if (!rate.allowed) {
    return c.json({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message:
          rate.scope === 'global'
            ? '本日の利用上限に達しました。時間をおいてお試しください。'
            : '本日の利用上限に達しました。',
        retryable: false,
      },
    });
  }

  let provider: MenuRecipesProvider;
  try {
    provider = resolveMenuRecipesProvider();
  } catch (err) {
    if (err instanceof MenuRecipesConfigError) {
      return c.json({
        ok: false,
        error: { code: 'AI_API_UNAVAILABLE', message: 'AI 推論が利用できません', retryable: false },
      });
    }
    throw err;
  }

  const { days, mealTime, existingTitles, pantry, preferences, locale, unitSystem } =
    c.req.valid('json');

  const result = await runMenuRecipesAgent(
    {
      days,
      existingTitles,
      pantry,
      // exactOptionalPropertyTypes: 省略可フィールドはスプレッドで組み立てる（リポジトリの既定）
      ...(preferences !== undefined && { preferences }),
      // 時間帯（省略 = 夕）。プロンプトの出し分けは provider 側
      ...(mealTime !== undefined && { mealTime }),
      outputLocale: parseOutputLocale(locale),
      unitSystem: parseUnitSystem(unitSystem),
    },
    provider,
  );

  // 消費は provider 成功時のみ。枠を飛ばした場合（token/premium）は記録しない
  if (result.ok && !bypassMonthlyQuota) {
    recordMonthlyUse(deviceId, QUOTA_CATEGORY);
  }

  // Always 200 — errors are in the response body (AgentResult pattern).
  return c.json(result);
});

// ─── レシピ表紙の AI 生成（イメージ）（docs/レシピ表紙AI生成設計.md） ──────────

const inferCoverImageSchema = z.object({
  title: z.string().min(1, 'タイトルが空です').max(100, 'タイトルが長すぎます'),
  ingredientNames: z.array(z.string().min(1).max(50)).max(MAX_COVER_INGREDIENTS),
  tags: z.array(z.string().min(1).max(30)).max(MAX_COVER_TAGS),
  locale: z.enum(['ja', 'en']).optional(),
});

let coverImageProviderOverride: CoverImageProvider | null = null;

export function setCoverImageProviderForTesting(provider: CoverImageProvider | null): void {
  coverImageProviderOverride = provider;
}

function resolveCoverImageProvider(): CoverImageProvider {
  return coverImageProviderOverride ?? new GeminiCoverImageProvider();
}

inferRouter.post('/cover-image', zValidator('json', inferCoverImageSchema), async (c) => {
  // /infer/menu と同じ書式チェックだけ行う（乱数のインストール UUID・個人情報ではない）。
  // 月次枠はここでは使わない — 画像は別勘定で、無料枠（月 3 枚）は
  // **端末ローカルで**数える（docs/フリーミアム設計.md §11）。サーバーは
  // 下の COVER_POOL（日次プール）だけでコストを守る。
  const deviceId = c.req.header('x-device-id');
  if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) {
    return c.json({
      ok: false,
      error: { code: 'UNKNOWN', message: '端末IDが不正です', retryable: false },
    });
  }

  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  // 専用プール（COVER_POOL）。RECIPE_POOL とは共有しない
  // — 1 枚 ≒¥5.0 はテキスト推論の 11〜17 倍で、共有すると安い呼び出しが
  // 高い呼び出しの枠に締め出される（rate-limit.ts の COVER_POOL コメント参照）。
  const rate = checkRateLimit(clientId, COVER_POOL);
  if (!rate.allowed) {
    return c.json({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message:
          rate.scope === 'global'
            ? '本日の利用上限に達しました。時間をおいてお試しください。'
            : '本日の利用上限に達しました。',
        retryable: false,
      },
    });
  }

  let provider: CoverImageProvider;
  try {
    provider = resolveCoverImageProvider();
  } catch (err) {
    if (err instanceof CoverImageConfigError) {
      return c.json({
        ok: false,
        error: { code: 'AI_API_UNAVAILABLE', message: 'AI 推論が利用できません', retryable: false },
      });
    }
    throw err;
  }

  const { title, ingredientNames, tags, locale } = c.req.valid('json');

  const result = await runCoverImageAgent(
    {
      title,
      ingredientNames,
      tags,
      outputLocale: parseOutputLocale(locale),
    },
    provider,
  );

  // Always 200 — errors are in the response body (AgentResult pattern).
  return c.json(result);
});

export default inferRouter;
