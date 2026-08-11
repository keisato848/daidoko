/**
 * POST /api/v1/infer/photo — dish-photo → recipe draft inference (Vision LLM).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { runPhotoInferAgent } from '../agents/photo-infer.agent.js';
import {
  GeminiVisionRecipeProvider,
  VisionConfigError,
  type VisionRecipeProvider,
} from '../lib/vision-recipe.js';
import {
  GeminiMealVisionProvider,
  MealVisionConfigError,
  MealVisionRequestError,
  type MealVisionProvider,
} from '../lib/meal-vision.js';
import {
  GeminiReceiptVisionProvider,
  ReceiptVisionConfigError,
  ReceiptVisionRequestError,
  type ReceiptVisionProvider,
} from '../lib/receipt-vision.js';
import {
  GeminiRecipeRefineProvider,
  RefineConfigError,
  type RecipeRefineProvider,
  type RefineRecipeSnapshot,
} from '../lib/recipe-refine.js';
import { runRecipeRefineAgent } from '../agents/recipe-refine.agent.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { parseOutputLocale, parseUnitSystem } from '../lib/output-locale.js';
import {
  ConsultConfigError,
  GeminiRecipeConsultProvider,
  MAX_CONSULT_MESSAGES,
  type ConsultDraft,
  type RecipeConsultProvider,
} from '../lib/recipe-consult.js';
import { runRecipeConsultAgent } from '../agents/recipe-consult.agent.js';

const inferRouter = new Hono();

// base64 of a ~1024px JPEG is well under this; guard against oversized payloads.
const MAX_IMAGE_BASE64_LENGTH = 8_000_000; // ~6 MB decoded

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

  const result = await runPhotoInferAgent(
    {
      imageBase64,
      mimeType,
      ...(context !== undefined && { context }),
      outputLocale: parseOutputLocale(locale),
      unitSystem: parseUnitSystem(unitSystem),
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
    return c.json({ ok: true, data });
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

const inferReceiptSchema = z.object({
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

  const { imageBase64, mimeType, locale } = c.req.valid('json');

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
    const data = await provider.infer({
      imageBase64,
      mimeType,
      outputLocale: parseOutputLocale(locale),
    });
    return c.json({ ok: true, data });
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
      messages,
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

export default inferRouter;
