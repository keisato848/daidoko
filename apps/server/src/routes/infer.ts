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

export default inferRouter;
