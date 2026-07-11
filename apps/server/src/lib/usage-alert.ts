/**
 * Operator usage alerts — email the operator each time global AI usage crosses
 * another 10% of INFER_GLOBAL_DAILY_LIMIT within the current 24h window.
 *
 * Transport is the Resend HTTP API (https://resend.com). Volume is at most
 * 10 mails per window, so the free tier is plenty. Configuration via env:
 *   - RESEND_API_KEY          Resend secret (absent → alerts disabled)
 *   - USAGE_ALERT_EMAIL_TO    recipient address (absent → alerts disabled)
 *   - USAGE_ALERT_EMAIL_FROM  sender (default: Resend onboarding sender, which
 *                             can deliver only to the Resend account owner)
 *
 * Fire-and-forget: send failures are logged to stderr and never affect the
 * request path. Dedup state is in-memory per window, mirroring the
 * rate-limit.ts buckets — a restart mid-window repeats at most one mail for
 * the decile reached after the counters reset, which is acceptable.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

interface WindowState {
  resetAt: number;
  notified: Set<number>;
}

let state: WindowState = { resetAt: 0, notified: new Set() };

/**
 * Called after each allowed request with the current global count. Sends one
 * mail per 10% step (10%, 20%, … 100%) per window.
 */
export function notifyGlobalUsage(count: number, limit: number, resetAt: number): void {
  if (limit <= 0 || count <= 0) return;
  const apiKey = process.env['RESEND_API_KEY']?.trim();
  const to = process.env['USAGE_ALERT_EMAIL_TO']?.trim();
  if (!apiKey || !to) return;

  if (state.resetAt !== resetAt) {
    state = { resetAt, notified: new Set() };
  }

  const decile = Math.min(10, Math.floor((count * 10) / limit));
  if (decile < 1 || state.notified.has(decile)) return;
  // Mark every decile up to the current one so a jump (e.g. counters rebuilt
  // after a restart) produces one mail, not a backlog of stale steps.
  for (let d = 1; d <= decile; d += 1) state.notified.add(d);

  const subject = `だいどこ AI利用 ${decile * 10}% 到達（${count}/${limit} 回）`;
  const text = [
    `AI 推論のグローバル日次利用が上限の ${decile * 10}% に達しました。`,
    '',
    `現在: ${count} 回 / 上限 ${limit} 回`,
    `カウンタのリセット: ${new Date(resetAt).toISOString()}`,
    '',
    '上限は Railway の環境変数 INFER_GLOBAL_DAILY_LIMIT で調整できます。',
  ].join('\n');

  void sendAlert(apiKey, to, subject, text);
}

async function sendAlert(apiKey: string, to: string, subject: string, text: string): Promise<void> {
  try {
    const from = process.env['USAGE_ALERT_EMAIL_FROM']?.trim() || 'daidoko <onboarding@resend.dev>';
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      process.stderr.write(
        `usage-alert: Resend responded ${res.status}: ${detail.slice(0, 200)}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(`usage-alert: ${err instanceof Error ? err.message : 'send failed'}\n`);
  }
}

/** Test helper: clear dedup state. */
export function resetUsageAlertForTesting(): void {
  state = { resetAt: 0, notified: new Set() };
}
