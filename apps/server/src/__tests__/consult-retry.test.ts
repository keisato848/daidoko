import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiRecipeConsultProvider, CONSULT_RETRY_BUDGET_MS } from '../lib/recipe-consult.js';
import app from '../index.js';
import { setConsultProviderForTesting } from '../routes/infer.js';

describe('GeminiRecipeConsultProvider retry logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries on 503 and logs correctly', async () => {
    const logs: string[] = [];
    const provider = new GeminiRecipeConsultProvider({
      apiKey: 'dummy-key',
      log: (line) => logs.push(line),
    });

    let fetchCount = 0;
    vi.stubGlobal('fetch', async (_url: string, _init: RequestInit) => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return {
          ok: false,
          status: 503,
          text: async () => 'busy',
        };
      }
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '{"reply":"ok","ready":false,"draft":null}' }],
              },
            },
          ],
        }),
      };
    });

    const p = provider.consult({ messages: [{ role: 'user', text: 'hi' }] });
    await vi.advanceTimersByTimeAsync(1500);
    const res = await p;

    expect(res.reply).toBe('ok');
    expect(logs).toHaveLength(3);

    const log1 = JSON.parse(logs[0].replace('[infer/consult] ', ''));
    expect(log1.attempt).toBe(1);
    expect(log1.outcome).toBe('http');
    expect(log1.status).toBe(503);

    const log2 = JSON.parse(logs[1].replace('[infer/consult] ', ''));
    expect(log2.attempt).toBe(2);
    expect(log2.outcome).toBe('ok');

    const log3 = JSON.parse(logs[2].replace('[infer/consult] ', ''));
    expect(log3.finalOutcome).toBe('ok');
    expect(typeof log3.totalElapsedMs).toBe('number');

    for (const line of logs) {
      expect(line).not.toContain('key=');
      expect(line).not.toContain('dummy-key');
    }
  });

  it('aborts fetch on timeout and logs outcome as timeout', async () => {
    const logs: string[] = [];
    const provider = new GeminiRecipeConsultProvider({
      apiKey: 'dummy-key',
      log: (line) => logs.push(line),
    });

    vi.stubGlobal('fetch', async (_url: string, init: { signal?: AbortSignal }) => {
      return new Promise((_, reject) => {
        if (init.signal?.aborted) {
          const err = new Error('abort');
          err.name = 'AbortError';
          return reject(err);
        }
        init.signal?.addEventListener('abort', () => {
          const err = new Error('abort');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const p = provider.consult({ messages: [{ role: 'user', text: 'hi' }] });
    // Prevent unhandled promise rejection before expect attaches catch
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(CONSULT_RETRY_BUDGET_MS);

    await expect(p).rejects.toThrow();

    expect(logs.length).toBeGreaterThan(0);
    const log1 = JSON.parse(logs[0].replace('[infer/consult] ', ''));
    expect(log1.attempt).toBe(1);
    expect(log1.outcome).toBe('timeout');
  });

  it('CONSULT_RETRY_BUDGET_MS is 133_500 (#331 で値を決め直したらこのテストも更新)', () => {
    expect(CONSULT_RETRY_BUDGET_MS).toBe(133_500);
  });
});

describe('Route /consult agent-error logging', () => {
  beforeEach(() => {
    setConsultProviderForTesting(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs agent-error with [infer/consult] when provider throws', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    setConsultProviderForTesting({
      consult: async () => {
        throw new Error('Some provider error');
      },
    });

    const res = await app.request('/api/v1/infer/consult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', text: 'hi' }] }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(false);

    const call = writeSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('[infer/consult]'),
    );
    expect(call).toBeDefined();
    if (!call) throw new Error('call not found');
    expect(call[0]).toContain('agent-error');
  });
});
