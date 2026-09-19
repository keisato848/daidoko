/**
 * 一括生成の非同期ジョブ（R34・`docs/買い物リスト・在庫設計.md` §10.12.3）。
 *
 *   POST   /api/v1/infer/menu-recipes/jobs        受理して 202（生成は応答の後で走る）
 *   GET    /api/v1/infer/menu-recipes/jobs/:id    状態と結果
 *   DELETE /api/v1/infer/menu-recipes/jobs/:id    受け取り済み（行を消す・冪等）
 *
 * 同期の `POST /infer/menu-recipes` は**残す**（旧アプリと、新アプリがジョブ経路を使えないときの倒し先）。
 * 認可と枠の判定順は同期ルートと同じ（端末 ID → 月次枠の peek → 日次上限）。順序が本質 —
 * `checkRateLimit` は許可時に即カウンタを増やすので、枠切れの連打が共有プールを食う（§10.10.1）。
 */
import { randomUUID } from 'node:crypto';

import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getClientIp } from '../lib/client-ip.js';
import { EXPO_PUSH_TOKEN_PATTERN } from '../lib/expo-push.js';
import {
  DEVICE_ID_PATTERN,
  QUOTA_CATEGORY,
  menuRecipesRequestSchema,
  monthlyFreeLimit,
  resolveMenuRecipesProvider,
} from '../lib/infer-guards.js';
import { kickRunner, type MenuJobPartInput } from '../lib/menu-job-runner.js';
import {
  MENU_JOB_PENDING_TTL_MS,
  findActiveJobForDevice,
  getMenuJobDb,
  menuJobs,
  sweepMenuJobs,
} from '../lib/menu-job-store.js';
import { MenuRecipesConfigError } from '../lib/menu-recipes.js';
import { parseOutputLocale, parseUnitSystem } from '../lib/output-locale.js';
import { peekMonthlyQuota } from '../lib/quota-store.js';
import { RECIPE_POOL, checkRateLimit } from '../lib/rate-limit.js';

/** 1 ジョブの part の上限。主菜＋枠の種類 3 つまで（受付票 #7「枠の種類ごとに 3 回」） */
export const MAX_MENU_JOB_PARTS = 4;

const postJobsSchema = z
  .object({
    parts: z
      .array(z.object({ key: z.string().min(1).max(16), request: menuRecipesRequestSchema }))
      .min(1)
      .max(MAX_MENU_JOB_PARTS),
    expoPushToken: z.string().max(200).regex(EXPO_PUSH_TOKEN_PATTERN).optional(),
    locale: z.enum(['ja', 'en']).optional(),
  })
  // key は結果を突き合わせる鍵。重複すると、どちらの結果か端末が区別できない
  .refine((body) => new Set(body.parts.map((p) => p.key)).size === body.parts.length, {
    message: 'parts[].key must be unique',
  });

const menuJobsRouter = new Hono();

function fail(code: string, message: string) {
  return { ok: false as const, error: { code, message, retryable: false } };
}

menuJobsRouter.post('/', zValidator('json', postJobsSchema), (c) => {
  // Lambda は応答後の処理が保証されない（`infra/` の CDK 構成）。アプリは同期経路へ倒す
  if (process.env['AWS_LAMBDA_FUNCTION_NAME']) {
    return c.json(fail('AI_API_UNAVAILABLE', 'この環境では非同期の生成を利用できません'));
  }

  const deviceId = c.req.header('x-device-id');
  if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) {
    return c.json(fail('UNKNOWN', '端末IDが不正です'));
  }

  const quotaSource = c.req.header('x-quota-source');
  const bypassQuota = quotaSource === 'token' || quotaSource === 'premium';
  if (!bypassQuota && !peekMonthlyQuota(deviceId, QUOTA_CATEGORY, monthlyFreeLimit())) {
    return c.json(fail('FREE_QUOTA_EXCEEDED', '今月の無料枠を使い切りました。'));
  }

  sweepMenuJobs();

  // **同じ端末の走行中ジョブがあれば、それを返す**（新しく消費しない）。連打・再送・
  // 画面を開き直しての再投入で、同じ生成を二重に走らせない
  const running = findActiveJobForDevice(deviceId);
  if (running) {
    return c.json({ ok: true, data: { jobId: running.id, status: running.status } }, 202);
  }

  try {
    resolveMenuRecipesProvider();
  } catch (err) {
    if (err instanceof MenuRecipesConfigError) {
      return c.json(fail('AI_API_UNAVAILABLE', 'AI 推論が利用できません'));
    }
    throw err;
  }

  const { parts, expoPushToken, locale } = c.req.valid('json');

  // 日次上限は **part の数だけ**消費する（実コストは推論の回数に比例する）。月次枠は 1 ジョブ 1 回で、
  // 成功したときに runner が記録する（同期ルートの「消費は成功時のみ」と同じ）
  const clientId = getClientIp({ get: (n) => c.req.header(n) });
  const rate = checkRateLimit(clientId, RECIPE_POOL, Date.now(), parts.length);
  if (!rate.allowed) {
    return c.json(
      fail(
        'RATE_LIMITED',
        rate.scope === 'global'
          ? '本日の利用上限に達しました。時間をおいてお試しください。'
          : '本日の利用上限に達しました。',
      ),
    );
  }

  // runner が読む形（`MenuRecipesInput`）へここで直す。locale / unitSystem の解釈を 1 か所にする
  const inputs: MenuJobPartInput[] = parts.map(({ key, request }) => ({
    key,
    request: {
      days: request.days,
      existingTitles: request.existingTitles,
      pantry: request.pantry,
      // exactOptionalPropertyTypes: undefined を明示代入しない（同期ルートと同じ書き方）
      ...(request.preferences !== undefined && { preferences: request.preferences }),
      ...(request.mealTime !== undefined && { mealTime: request.mealTime }),
      ...(request.slotKind !== undefined && { slotKind: request.slotKind }),
      ...(request.mainTitles !== undefined && { mainTitles: request.mainTitles }),
      outputLocale: parseOutputLocale(request.locale ?? locale),
      unitSystem: parseUnitSystem(request.unitSystem),
    },
  }));

  const now = Date.now();
  const jobId = randomUUID();
  getMenuJobDb()
    .insert(menuJobs)
    .values({
      id: jobId,
      deviceId,
      status: 'queued',
      inputJson: JSON.stringify(inputs),
      expoPushToken: expoPushToken ?? null,
      locale: locale ?? null,
      bypassQuota,
      attempts: 0,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + MENU_JOB_PENDING_TTL_MS).toISOString(),
    })
    .run();

  kickRunner();
  return c.json({ ok: true, data: { jobId, status: 'queued' } }, 202);
});

menuJobsRouter.get('/:jobId', (c) => {
  const deviceId = c.req.header('x-device-id');
  // **他人のジョブは「無い」と答える**（403 にすると jobId の存在が漏れる）
  if (!deviceId) return c.json(fail('NOT_FOUND', 'not found'), 404);

  const row = getMenuJobDb()
    .select()
    .from(menuJobs)
    .where(and(eq(menuJobs.id, c.req.param('jobId')), eq(menuJobs.deviceId, deviceId)))
    .get();
  if (!row || row.expiresAt < new Date().toISOString()) {
    return c.json(fail('NOT_FOUND', 'not found'), 404);
  }

  const result: { parts?: unknown } = row.resultJson ? JSON.parse(row.resultJson) : {};
  return c.json({
    ok: true,
    data: {
      jobId: row.id,
      status: row.status,
      createdAt: row.createdAt,
      ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
      ...(row.status === 'done' ? { parts: result.parts ?? [] } : {}),
      ...(row.status === 'failed'
        ? {
            error: {
              code: row.errorCode ?? 'UNKNOWN',
              message: row.errorCode ?? 'UNKNOWN',
              retryable: row.errorRetryable === true,
            },
          }
        : {}),
    },
  });
});

menuJobsRouter.delete('/:jobId', (c) => {
  const deviceId = c.req.header('x-device-id');
  if (deviceId) {
    getMenuJobDb()
      .delete(menuJobs)
      .where(and(eq(menuJobs.id, c.req.param('jobId')), eq(menuJobs.deviceId, deviceId)))
      .run();
  }
  // 冪等。無くても 204（受け取り済みの再送を失敗にしない）
  return c.body(null, 204);
});

export default menuJobsRouter;
