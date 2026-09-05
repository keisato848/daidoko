/**
 * アプリ内報告の受け口（docs/レシピ表紙AI生成設計.md §6）。
 *
 * Play の AI 生成コンテンツポリシー（"without needing to exit the app"）を満たすための
 * 経路。**個人情報は受けない** — カテゴリと 500 字までの短文だけ（zod で強制）。
 * 保存は console.log ＋ 既存の運用者通知経路（`lib/usage-alert.ts`）へ転送するだけ
 * （設計 §6「無ければログのみで可 — 過剰に作らない」）。専用の DB テーブルは持たない。
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { sendOperatorAlert } from '../lib/usage-alert.js';

const reportRouter = new Hono();

/** `x-device-id` の書式チェックだけ行う（乱数のインストール UUID・個人情報ではない）。 */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const reportSchema = z.object({
  category: z.enum(['inappropriate', 'inaccurate', 'other']),
  text: z.string().max(500).optional(),
  /** どの画面からの報告か（例: 'cover-image' | 'consult' | 'photo-recipe'）。ログの手がかり用。 */
  source: z.string().max(60).optional(),
});

reportRouter.post('/content', zValidator('json', reportSchema), (c) => {
  const deviceId = c.req.header('x-device-id');
  if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) {
    return c.json(
      { ok: false, error: { code: 'UNKNOWN', message: '端末IDが不正です', retryable: false } },
      400,
    );
  }

  const { category, text, source } = c.req.valid('json');

  // 個人情報は受けていない前提（zod がカテゴリ＋短文だけに絞る）なのでそのままログへ。
  // console.log は Railway のログ基盤に載る——保存先を新設しない
  process.stdout.write(
    `[report] category=${category} source=${source ?? 'unknown'} deviceId=${deviceId} text=${JSON.stringify(text ?? '')}\n`,
  );

  sendOperatorAlert(
    `AI生成コンテンツの報告: ${category}`,
    [
      `カテゴリ: ${category}`,
      `画面: ${source ?? '不明'}`,
      `端末ID: ${deviceId}`,
      '',
      text ? `詳細:\n${text}` : '（詳細の記入なし）',
    ].join('\n'),
  );

  return c.json({ ok: true });
});

export default reportRouter;
