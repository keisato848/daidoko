import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentBridge } from '../bridge/AgentBridge';
import type { HookContext, HookHandler } from '../bridge/types';

beforeEach(() => {
  AgentBridge._reset();
});

describe('AgentBridge.on / off / fire', () => {
  it('should fire registered handlers', async () => {
    const handler = vi.fn();
    AgentBridge.on('beforeAgentRun', handler);

    await AgentBridge.fire('beforeAgentRun', 'A1', 'trace-1', 'span-1', { test: true });

    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0][0] as HookContext;
    expect(ctx.hookName).toBe('beforeAgentRun');
    expect(ctx.agentId).toBe('A1');
    expect(ctx.traceId).toBe('trace-1');
    expect(ctx.spanId).toBe('span-1');
    expect(ctx.payload).toEqual({ test: true });
  });

  it('should not fire handlers after off()', async () => {
    const handler = vi.fn();
    AgentBridge.on('afterAgentRun', handler);
    AgentBridge.off('afterAgentRun', handler);

    await AgentBridge.fire('afterAgentRun', 'A1', 'trace-1', 'span-1');

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support multiple handlers on the same hook', async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    AgentBridge.on('beforeDbRead', handler1);
    AgentBridge.on('beforeDbRead', handler2);

    await AgentBridge.fire('beforeDbRead', 'A8', 'trace-1', 'span-1');

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('should handle async handlers', async () => {
    const order: number[] = [];
    const asyncHandler: HookHandler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(1);
    };
    AgentBridge.on('afterDbWrite', asyncHandler);

    await AgentBridge.fire('afterDbWrite', 'A8', 'trace-1', 'span-1');

    expect(order).toEqual([1]);
  });

  it('should not throw when firing a hook with no handlers', async () => {
    await expect(
      AgentBridge.fire('onSyncConflict', 'A6', 'trace-1', 'span-1'),
    ).resolves.toBeUndefined();
  });
});

describe('AgentBridge.register / call', () => {
  it('should call a registered agent runner', async () => {
    AgentBridge.register<string, string>('A1', async (input) => ({
      ok: true,
      data: `processed: ${input}`,
    }));

    const result = await AgentBridge.call<string, string>('A1', 'hello');

    expect(result.ok).toBe(true);
    expect(result.data).toBe('processed: hello');
  });

  it('should return error for unregistered agent', async () => {
    const result = await AgentBridge.call('A2', {});

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('not registered');
  });

  it('should fire beforeAgentRun and afterAgentRun hooks', async () => {
    const hooks: string[] = [];
    AgentBridge.on('beforeAgentRun', () => {
      hooks.push('before');
    });
    AgentBridge.on('afterAgentRun', () => {
      hooks.push('after');
    });

    AgentBridge.register<string, string>('A4', async (input) => ({
      ok: true,
      data: input,
    }));

    await AgentBridge.call('A4', 'test');

    expect(hooks).toEqual(['before', 'after']);
  });

  it('should fire onAgentError when runner throws', async () => {
    const errorHandler = vi.fn();
    AgentBridge.on('onAgentError', errorHandler);

    AgentBridge.register('A5', async () => {
      throw new Error('AI unavailable');
    });

    const result = await AgentBridge.call('A5', {});

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('AI unavailable');
    expect(errorHandler).toHaveBeenCalledTimes(1);
  });
});

describe('AgentBridge.pipe', () => {
  it('should chain agents sequentially', async () => {
    AgentBridge.register<number, number>('A1', async (n) => ({
      ok: true,
      data: n + 1,
    }));
    AgentBridge.register<number, number>('A2', async (n) => ({
      ok: true,
      data: n * 2,
    }));

    const result = await AgentBridge.pipe<number>(['A1', 'A2'], 5);

    expect(result.ok).toBe(true);
    expect(result.data).toBe(12); // (5 + 1) * 2
  });

  it('should stop on first failure', async () => {
    AgentBridge.register<number, number>('A1', async () => ({
      ok: false,
      error: { code: 'FETCH_FAILED', message: 'fail', retryable: true },
    }));
    AgentBridge.register<number, number>('A2', async (n) => ({
      ok: true,
      data: n * 2,
    }));

    const result = await AgentBridge.pipe<number>(['A1', 'A2'], 5);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('FETCH_FAILED');
  });
});

describe('AgentBridge._reset', () => {
  it('should clear all handlers and runners', async () => {
    AgentBridge.on('beforeAgentRun', vi.fn());
    AgentBridge.register('A1', async () => ({ ok: true, data: null }));

    AgentBridge._reset();

    const result = await AgentBridge.call('A1', {});
    expect(result.ok).toBe(false);
  });
});
