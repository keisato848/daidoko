/**
 * Unit tests for the operator usage-alert emails (10% steps of the global cap).
 * vitest with a mocked fetch — no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkRateLimit, resetRateLimitForTesting } from '../lib/rate-limit.js';
import { notifyGlobalUsage, resetUsageAlertForTesting } from '../lib/usage-alert.js';

const RESET_AT = 1_700_000_000_000;

interface SentMail {
  to: string;
  subject: string;
  text: string;
}

function mockResend() {
  const sent: SentMail[] = [];
  const spy = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as SentMail);
    return new Response(JSON.stringify({ id: 'mail' }), { status: 200 });
  });
  vi.stubGlobal('fetch', spy);
  return { sent, spy };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetUsageAlertForTesting();
  resetRateLimitForTesting();
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('USAGE_ALERT_EMAIL_TO', 'op@example.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('notifyGlobalUsage', () => {
  it('環境変数が無ければ何も送らない', async () => {
    vi.unstubAllEnvs();
    const { spy } = mockResend();
    notifyGlobalUsage(10, 100, RESET_AT);
    await flushAsync();
    expect(spy).not.toHaveBeenCalled();
  });

  it('10% 到達で1通送る（9% では送らない）', async () => {
    const { sent } = mockResend();
    notifyGlobalUsage(9, 100, RESET_AT);
    await flushAsync();
    expect(sent).toHaveLength(0);

    notifyGlobalUsage(10, 100, RESET_AT);
    await flushAsync();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('op@example.com');
    expect(sent[0]?.subject).toContain('10%');
    expect(sent[0]?.subject).toContain('10/100');
  });

  it('同じ 10% 帯では重複送信しない・次の帯で再送する', async () => {
    const { sent } = mockResend();
    for (let count = 10; count <= 19; count += 1) notifyGlobalUsage(count, 100, RESET_AT);
    await flushAsync();
    expect(sent).toHaveLength(1);

    notifyGlobalUsage(20, 100, RESET_AT);
    await flushAsync();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.subject).toContain('20%');
  });

  it('カウンタが飛んだ場合はまとめて1通（現在の帯のみ）', async () => {
    const { sent } = mockResend();
    notifyGlobalUsage(55, 100, RESET_AT);
    await flushAsync();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain('50%');

    // 過去の帯（10〜40%）は遡って送らない
    notifyGlobalUsage(56, 100, RESET_AT);
    await flushAsync();
    expect(sent).toHaveLength(1);
  });

  it('ウィンドウが変わったら通知履歴をリセットする', async () => {
    const { sent } = mockResend();
    notifyGlobalUsage(10, 100, RESET_AT);
    notifyGlobalUsage(10, 100, RESET_AT + 1);
    await flushAsync();
    expect(sent).toHaveLength(2);
  });

  it('100% 到達も通知する（上限超えは 100% に丸める）', async () => {
    const { sent } = mockResend();
    notifyGlobalUsage(100, 100, RESET_AT);
    await flushAsync();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain('100%');
  });

  it('送信失敗してもスローしない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    expect(() => notifyGlobalUsage(10, 100, RESET_AT)).not.toThrow();
    await flushAsync();
  });
});

describe('GAS Webhook トランスポート', () => {
  function stubWebhookEnv(): void {
    vi.unstubAllEnvs();
    vi.stubEnv('USAGE_ALERT_WEBHOOK_URL', 'https://script.google.com/macros/s/XYZ/exec');
    vi.stubEnv('USAGE_ALERT_WEBHOOK_TOKEN', 'secret-token');
  }

  it('Webhook URL 設定時は GAS へ token 付き JSON を POST する', async () => {
    stubWebhookEnv();
    const calls: { url: string; body: { token: string; subject: string; text: string } }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)) as (typeof calls)[number]['body'],
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    notifyGlobalUsage(10, 100, RESET_AT);
    await flushAsync();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://script.google.com/macros/s/XYZ/exec');
    expect(calls[0]?.body.token).toBe('secret-token');
    expect(calls[0]?.body.subject).toContain('10%');
    expect(calls[0]?.body.text).toContain('10 回');
  });

  it('Webhook と Resend の両方が設定されていれば Webhook を優先する', async () => {
    stubWebhookEnv();
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubEnv('USAGE_ALERT_EMAIL_TO', 'op@example.com');
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    notifyGlobalUsage(10, 100, RESET_AT);
    await flushAsync();
    expect(urls).toEqual(['https://script.google.com/macros/s/XYZ/exec']);
  });

  it('GAS が ok:false を返してもスローしない（stderr ログのみ）', async () => {
    stubWebhookEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 200 }),
      ),
    );
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => notifyGlobalUsage(10, 100, RESET_AT)).not.toThrow();
    await flushAsync();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('usage-alert'));
    stderrSpy.mockRestore();
  });
});

describe('checkRateLimit との配線', () => {
  it('許可されたリクエストの積算で 10% 通知が飛ぶ', async () => {
    vi.stubEnv('INFER_DAILY_LIMIT', '0');
    vi.stubEnv('INFER_GLOBAL_DAILY_LIMIT', '10');
    const { sent } = mockResend();

    // 1回目 = グローバル 1/10 = 10% でちょうど1通
    expect(checkRateLimit('client-a').allowed).toBe(true);
    await flushAsync();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain('10%');
  });
});
