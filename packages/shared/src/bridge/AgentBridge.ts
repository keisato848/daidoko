/**
 * AgentBridge — エージェント間通信の中央ハブ
 *
 * - on/off: フックハンドラの登録・解除
 * - fire: フックの発火（全登録ハンドラを呼び出す）
 * - register/call: エージェントの登録と呼び出し
 * - pipe: 複数エージェントの直列実行
 */
import type { AgentId, AgentResult, AgentRunner } from '../types/agent';
import type { BridgeCallOptions, HookContext, HookHandler, HookName } from './types';
import { captureTimestamp } from './timestamp';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** フックハンドラの登録簿 */
const handlers = new Map<HookName, Set<HookHandler>>();

/** エージェントランナーの登録簿 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runners = new Map<AgentId, AgentRunner<any, any>>();

export const AgentBridge = {
  /** フックハンドラを登録する */
  on<P = unknown>(hook: HookName, handler: HookHandler<P>): void {
    if (!handlers.has(hook)) {
      handlers.set(hook, new Set());
    }
    handlers.get(hook)!.add(handler as HookHandler);
  },

  /** フックハンドラを解除する */
  off(hook: HookName, handler: HookHandler): void {
    handlers.get(hook)?.delete(handler);
  },

  /** フックを発火する（登録済みハンドラ全てを呼び出す） */
  async fire<P = unknown>(
    hook: HookName,
    agentId: AgentId,
    traceId: string,
    spanId: string,
    payload?: P,
    parentSpanId?: string,
  ): Promise<void> {
    const { wallTime, perfMark } = captureTimestamp();
    const ctx: HookContext<P> = {
      hookName: hook,
      agentId,
      traceId,
      spanId,
      wallTime,
      perfMark,
      ...(parentSpanId !== undefined && { parentSpanId }),
      ...(payload !== undefined && { payload }),
    };

    const hookHandlers = handlers.get(hook);
    if (!hookHandlers) return;

    const promises: Promise<void>[] = [];
    for (const handler of hookHandlers) {
      const result = (handler as HookHandler<P>)(ctx);
      if (result instanceof Promise) {
        promises.push(result);
      }
    }
    await Promise.all(promises);
  },

  /** エージェントランナーを登録する */
  register<I, O>(id: AgentId, runner: AgentRunner<I, O>): void {
    runners.set(id, runner);
  },

  /** エージェントを呼び出す */
  async call<I, O>(
    agentId: AgentId,
    input: I,
    opts?: BridgeCallOptions,
  ): Promise<AgentResult<O>> {
    const runner = runners.get(agentId);
    if (!runner) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: `Agent ${agentId} is not registered`,
          retryable: false,
        },
      };
    }

    const traceId = opts?.traceId ?? generateId();
    const spanId = generateId();

    await AgentBridge.fire('beforeAgentRun', agentId, traceId, spanId, { input }, opts?.parentSpanId);

    try {
      const result: AgentResult<O> = await runner(input);
      await AgentBridge.fire('afterAgentRun', agentId, traceId, spanId, { result }, opts?.parentSpanId);
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const agentResult: AgentResult<O> = {
        ok: false,
        error: { code: 'UNKNOWN', message, retryable: false },
      };
      await AgentBridge.fire('onAgentError', agentId, traceId, spanId, { error: message }, opts?.parentSpanId);
      return agentResult;
    }
  },

  /** 複数エージェントを直列に実行する（前の出力を次の入力に渡す） */
  async pipe<T>(
    agents: AgentId[],
    initial: T,
    opts?: BridgeCallOptions,
  ): Promise<AgentResult<T>> {
    let current: T = initial;

    for (const agentId of agents) {
      const result = await AgentBridge.call<T, T>(agentId, current, opts);
      if (!result.ok) {
        return result;
      }
      current = result.data as T;
    }

    return { ok: true, data: current };
  },

  /** テスト用: 全登録をクリアする */
  _reset(): void {
    handlers.clear();
    runners.clear();
  },
} as const;
