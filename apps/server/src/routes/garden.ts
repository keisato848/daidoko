/**
 * さいえん手帳（家庭菜園アプリ）がこのサーバーに相乗りしているルート群
 * （WBS 決定⑨）。レシピ系とは共存させない。
 *
 * - `POST /api/v1/garden/consult` … AI 相談（写真 → 診断・アドバイス）
 * - `POST /api/v1/garden/harvest` … 収穫の写真記録（写真 → 作物と個数）
 *
 * **2 つは別物として扱う。** 目的も出力の長さも単価も頻度も違うので、
 * プロンプト（`lib/garden-vision.ts` / `lib/harvest-vision.ts`）も
 * レート上限のプールも分けてある。
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  GeminiGardenConsultProvider,
  GardenVisionConfigError,
  GardenVisionRequestError,
  type GardenConsultProvider,
} from '../lib/garden-vision.js';
import {
  GeminiHarvestVisionProvider,
  HarvestVisionConfigError,
  HarvestVisionRequestError,
  sanitize as sanitizeHarvest,
  type HarvestVisionProvider,
} from '../lib/harvest-vision.js';
import { checkRateLimit, GARDEN_POOL, HARVEST_POOL } from '../lib/rate-limit.js';
import { parseOutputLocale } from '../lib/output-locale.js';

const gardenRouter = new Hono();

/** レート制限のクライアント識別。Railway は x-forwarded-for を付ける。 */
function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous'
  );
}

// base64 of a ~1024px JPEG is well under this; guard against oversized payloads.
const MAX_IMAGE_BASE64_LENGTH = 8_000_000; // ~6 MB decoded

const gardenConsultSchema = z.object({
  imageBase64: z.string().min(1, '画像が空です').max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** 栽培に登録されている作物名。品種推定の手がかり（任意） */
  cropName: z.string().max(50, '作物名が長すぎます').optional(),
  /** 相談・症状の説明（任意）。無ければ写真だけの診断になる */
  question: z.string().max(1000, '相談内容が長すぎます').optional(),
  /** 端末の言語。省略時は ja（さいえん手帳 v1.0 は日本語のみ） */
  locale: z.enum(['ja', 'en']).optional(),
});

// Lazily construct the provider so the route module imports without an API key
// (e.g. in tests). Tests can inject a provider via setGardenProviderForTesting.
let providerOverride: GardenConsultProvider | null = null;

export function setGardenProviderForTesting(provider: GardenConsultProvider | null): void {
  providerOverride = provider;
}

function resolveProvider(): GardenConsultProvider {
  return providerOverride ?? new GeminiGardenConsultProvider();
}

gardenRouter.post('/consult', zValidator('json', gardenConsultSchema), async (c) => {
  // **グローバル上限もレシピ系と分ける**（GARDEN_POOL）。以前は 1 本のカウンタを
  // 共有していて、だいどこのレシピ推論（¥0.45/回）が使い切ると さいえん手帳の
  // AI 相談（¥0.35/回）まで止まっていた。上限は GARDEN_GLOBAL_DAILY_LIMIT。
  const rate = checkRateLimit(clientIp(c), GARDEN_POOL);
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

  const { imageBase64, mimeType, cropName, question, locale } = c.req.valid('json');

  let provider: GardenConsultProvider;
  try {
    provider = resolveProvider();
  } catch (err) {
    if (err instanceof GardenVisionConfigError) {
      return c.json({
        ok: false,
        error: { code: 'AI_API_UNAVAILABLE', message: 'AI 相談が利用できません', retryable: false },
      });
    }
    throw err;
  }

  try {
    const data = await provider.consult({
      imageBase64,
      mimeType,
      ...(cropName !== undefined && { cropName }),
      ...(question !== undefined && { question }),
      outputLocale: parseOutputLocale(locale),
    });
    return c.json({ ok: true, data });
  } catch (err) {
    const retryable = err instanceof GardenVisionRequestError;
    // **理由をここで捨てない。** 以前はこの catch が err を握り潰していたため、
    // 失敗しても Railway のログには `POST /api/v1/garden/consult 200 134s` の 1 行しか
    // 残らず、**何が 4 回起きたのかを後から知る手段が無かった**（2026-08-19 に実際に踏んだ）。
    // GeminiGardenConsultProvider は失敗の種別を lastError に載せて投げてくる
    // （`request failed` = 中断/通信断 / `Gemini responded 429|503: …` / `empty model response`）。
    // ユーザーに見せる文言は変えない — 出すのはサーバーのログだけ。
    console.error('[garden/consult] failed:', err instanceof Error ? err.message : String(err));
    return c.json({
      ok: false,
      error: {
        code: 'AI_INFER_FAILED',
        message: '診断に失敗しました。時間をおいてお試しください。',
        retryable,
      },
    });
  }
});

// ─── 収穫の写真記録（saien-techo#143） ──────────────────────────────────────

const harvestSchema = z.object({
  imageBase64: z.string().min(1, '画像が空です').max(MAX_IMAGE_BASE64_LENGTH, '画像が大きすぎます'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** 栽培に登録されている作物名。推定の手がかり（任意） */
  cropName: z.string().max(50, '作物名が長すぎます').optional(),
  locale: z.enum(['ja', 'en']).optional(),
});

let harvestProviderOverride: HarvestVisionProvider | null = null;

export function setHarvestProviderForTesting(provider: HarvestVisionProvider | null): void {
  harvestProviderOverride = provider;
}

function resolveHarvestProvider(): HarvestVisionProvider {
  return harvestProviderOverride ?? new GeminiHarvestVisionProvider();
}

gardenRouter.post('/harvest', zValidator('json', harvestSchema), async (c) => {
  // **相談とも別のプール。** 単価が 1/5・頻度が桁違いなので、
  // 同じ枠に入れると安い呼び出しが高い呼び出しに締め出される。
  const rate = checkRateLimit(clientIp(c), HARVEST_POOL);
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

  const { imageBase64, mimeType, cropName, locale } = c.req.valid('json');

  let provider: HarvestVisionProvider;
  try {
    provider = resolveHarvestProvider();
  } catch (err) {
    if (err instanceof HarvestVisionConfigError) {
      return c.json({
        ok: false,
        error: {
          code: 'AI_API_UNAVAILABLE',
          message: '写真の読み取りが利用できません',
          retryable: false,
        },
      });
    }
    throw err;
  }

  try {
    const raw = await provider.analyze({
      imageBase64,
      mimeType,
      ...(cropName !== undefined && { cropName }),
      outputLocale: parseOutputLocale(locale),
    });
    // **必ずここを通す。** provider が何を返しても、台帳に載る値は境界で検める。
    return c.json({ ok: true, data: sanitizeHarvest(raw) });
  } catch (err) {
    // garden/consult と同じく、理由をログに残す（握り潰さない）。
    console.error('[garden/harvest] failed:', err instanceof Error ? err.message : String(err));
    return c.json({
      ok: false,
      error: {
        code: 'AI_INFER_FAILED',
        message: '写真を読み取れませんでした。数量は手で入力できます。',
        retryable: err instanceof HarvestVisionRequestError,
      },
    });
  }
});

export default gardenRouter;
