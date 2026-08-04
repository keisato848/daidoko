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

const inferRouter = new Hono();

// base64 of a ~1024px JPEG is well under this; guard against oversized payloads.
const MAX_IMAGE_BASE64_LENGTH = 8_000_000; // ~6 MB decoded

const inferPhotoSchema = z.object({
  imageBase64: z.string().min(1, '画像が空です').max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  context: z.string().max(1000, '補足テキストが長すぎます').optional(),
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

  const { imageBase64, mimeType, context } = c.req.valid('json');

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
    { imageBase64, mimeType, ...(context !== undefined && { context }) },
    provider,
  );
  // Always 200 — errors are in the response body (AgentResult pattern).
  return c.json(result);
});

// ─── POST /meal — meal photo → consumed-ingredient estimate (experimental) ────

const inferMealSchema = z.object({
  imageBase64: z.string().min(1, '画像が空です').max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
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

  const { imageBase64, mimeType } = c.req.valid('json');

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
    const data = await provider.infer({ imageBase64, mimeType });
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

  const { imageBase64, mimeType } = c.req.valid('json');

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
    const data = await provider.infer({ imageBase64, mimeType });
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

  const { recipe, feedback, images } = c.req.valid('json');

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
    { recipe: snapshot, feedback, ...(images !== undefined && { images }) },
    provider,
  );
  // Always 200 — errors are in the response body (AgentResult pattern).
  return c.json(result);
});

export default inferRouter;
