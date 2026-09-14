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

  it('retries on 502 and logs correctly, with id and detail', async () => {
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
          status: 502,
          text: async () => 'Bad Gateway key=SECRET',
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

    expect(fetchCount).toBe(2);
    expect(res.reply).toBe('ok');
    expect(logs).toHaveLength(3);

    const log1 = JSON.parse(logs[0].replace('[infer/consult] ', ''));
    expect(log1.attempt).toBe(1);
    expect(log1.outcome).toBe('http');
    expect(log1.status).toBe(502);
    expect(log1.detail).toBe('Bad Gateway key=***');
    expect(log1.detail.length).toBeLessThanOrEqual(120);

    const log2 = JSON.parse(logs[1].replace('[infer/consult] ', ''));
    expect(log2.attempt).toBe(2);
    expect(log2.outcome).toBe('ok');
    expect(log2.detail).toBeUndefined();

    const log3 = JSON.parse(logs[2].replace('[infer/consult] ', ''));
    expect(log3.finalOutcome).toBe('ok');
    expect(typeof log3.totalElapsedMs).toBe('number');

    const id = log1.id;
    expect(typeof id).toBe('string');
    expect(log2.id).toBe(id);
    expect(log3.id).toBe(id);

    for (const line of logs) {
      expect(line).not.toContain('key=SECRET');
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

    expect(logs).toHaveLength(5);
    for (let i = 0; i < 4; i++) {
      const log = JSON.parse(logs[i].replace('[infer/consult] ', ''));
      expect(log.attempt).toBe(i + 1);
      expect(log.outcome).toBe('timeout');
    }
    const finalLog = JSON.parse(logs[4].replace('[infer/consult] ', ''));
    expect(finalLog.finalOutcome).toBe('error');
  });

  it('logs quota on 429 quota exceeded', async () => {
    const logs: string[] = [];
    const provider = new GeminiRecipeConsultProvider({ apiKey: 'dummy', log: (l) => logs.push(l) });

    let fetchCount = 0;
    vi.stubGlobal('fetch', async () => {
      fetchCount++;
      return { ok: false, status: 429, text: async () => 'quota exceeded' };
    });

    const p = provider.consult({ messages: [{ role: 'user', text: 'hi' }] });
    await expect(p).rejects.toThrow('quota exceeded');

    expect(fetchCount).toBe(1);
    expect(logs).toHaveLength(2);

    const log1 = JSON.parse(logs[0].replace('[infer/consult] ', ''));
    expect(log1.attempt).toBe(1);
    expect(log1.outcome).toBe('quota');

    const log2 = JSON.parse(logs[1].replace('[infer/consult] ', ''));
    expect(log2.finalOutcome).toBe('quota');
  });

  it('breaks and logs error on 400', async () => {
    const logs: string[] = [];
    const provider = new GeminiRecipeConsultProvider({ apiKey: 'dummy', log: (l) => logs.push(l) });

    let fetchCount = 0;
    vi.stubGlobal('fetch', async () => {
      fetchCount++;
      return { ok: false, status: 400, text: async () => 'INVALID_ARGUMENT key=SECRET' };
    });

    const p = provider.consult({ messages: [{ role: 'user', text: 'hi' }] });
    await expect(p).rejects.toThrow('INVALID_ARGUMENT');

    expect(fetchCount).toBe(1);
    expect(logs).toHaveLength(2);

    const log1 = JSON.parse(logs[0].replace('[infer/consult] ', ''));
    expect(log1.attempt).toBe(1);
    expect(log1.outcome).toBe('http');
    expect(log1.status).toBe(400);
    expect(log1.detail).toBe('INVALID_ARGUMENT key=***');

    const log2 = JSON.parse(logs[1].replace('[infer/consult] ', ''));
    expect(log2.finalOutcome).toBe('error');
  });

  it('generates different id for different calls', async () => {
    const logs: string[] = [];
    const provider = new GeminiRecipeConsultProvider({ apiKey: 'dummy', log: (l) => logs.push(l) });

    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: '{"reply":"ok","ready":false,"draft":null}' }] } },
        ],
      }),
    }));

    await provider.consult({ messages: [{ role: 'user', text: 'hi' }] });
    await provider.consult({ messages: [{ role: 'user', text: 'hi' }] });

    const ids = logs.map((l) => JSON.parse(l.replace('[infer/consult] ', '')).id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
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
