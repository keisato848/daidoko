/**
 * HookLogger — 全フックのログ収集・バッファリング・書き出し
 *
 * - registerAll: 全フックに対してハンドラを登録
 * - handle: 各フック発火時にログエントリをバッファに追加
 * - flush: バッファ内容をライターに書き出す
 */
import type { HookContext, HookName, LogEntry, LogLevel } from './types';
import { ALL_HOOKS } from './types';
import { AgentBridge } from './AgentBridge';
import { captureTimestamp, elapsedMs } from './timestamp';

/** ログ書き込みインターフェース（プラットフォーム固有の実装を差し込む） */
export interface LogWriter {
  write(entries: LogEntry[]): Promise<void>;
}

/** フックからログレベルを推定 */
function hookToLevel(hookName: HookName): LogLevel {
  if (hookName === 'onAgentError' || hookName === 'onIntegrityCheckFailed') return 'error';
  if (hookName === 'onAgentRetry' || hookName === 'onSyncConflict' || hookName === 'onAuthFailure')
    return 'warn';
  if (hookName.startsWith('before')) return 'debug';
  return 'info';
}

/** PII を除去する簡易サニタイザー */
function sanitizePayload(payload: unknown): Record<string, unknown> | undefined {
  if (payload == null) return undefined;
  if (typeof payload !== 'object') return { value: String(payload) };

  const raw = payload as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  const sensitiveKeys = ['password', 'token', 'secret', 'email', 'userId', 'refreshToken'];

  for (const [key, value] of Object.entries(raw)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/** before* フック発火時の perfMark を保持（durationMs 計算用） */
const pendingMarks = new Map<string, number>();

/** ログバッファ */
let buffer: LogEntry[] = [];

/** flush タイマー */
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** バッファフラッシュ間隔 (ms) */
const FLUSH_INTERVAL_MS = 500;

/** ログライター（プラットフォーム別に設定する） */
let writer: LogWriter | null = null;

export const HookLogger = {
  /** ログライターを設定する */
  setWriter(w: LogWriter): void {
    writer = w;
  },

  /** 全フックに対してハンドラを登録する */
  registerAll(): void {
    for (const hook of ALL_HOOKS) {
      AgentBridge.on(hook, HookLogger.handle);
    }
  },

  /** 全フックからハンドラを解除する */
  unregisterAll(): void {
    for (const hook of ALL_HOOKS) {
      AgentBridge.off(hook, HookLogger.handle);
    }
  },

  /** フック発火時のハンドラ */
  handle(ctx: HookContext): void {
    const { hookName, agentId, traceId, spanId, parentSpanId, wallTime, perfMark, payload } = ctx;

    let durationMs: number | undefined;

    // before* フックの場合は perfMark を記録
    if (hookName.startsWith('before')) {
      pendingMarks.set(`${traceId}:${spanId}:${hookName}`, perfMark);
    }

    // after* フックの場合は対応する before* からの経過時間を計算
    if (hookName.startsWith('after')) {
      const beforeHook = hookName.replace('after', 'before') as HookName;
      const key = `${traceId}:${spanId}:${beforeHook}`;
      const startMark = pendingMarks.get(key);
      if (startMark !== undefined) {
        durationMs = elapsedMs(startMark, perfMark);
        pendingMarks.delete(key);
      }
    }

    const sanitized = payload !== undefined ? sanitizePayload(payload) : undefined;

    const entry: LogEntry = {
      traceId,
      spanId,
      wallTime,
      perfMark,
      agentId,
      hookName,
      level: hookToLevel(hookName),
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(sanitized !== undefined ? { payload: sanitized } : {}),
    };

    buffer.push(entry);
    HookLogger.scheduleFlush();
  },

  /** flush をスケジュールする（既にスケジュール済みなら何もしない） */
  scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void HookLogger.flush();
    }, FLUSH_INTERVAL_MS);
  },

  /** バッファ内容をライターに書き出す */
  async flush(): Promise<void> {
    if (buffer.length === 0) return;

    const entries = buffer;
    buffer = [];

    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    if (writer) {
      await writer.write(entries);
    }
  },

  /** バッファの現在のエントリ数を返す（テスト用） */
  get bufferSize(): number {
    return buffer.length;
  },

  /** 内部状態をリセットする（テスト用） */
  _reset(): void {
    buffer = [];
    pendingMarks.clear();
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    writer = null;
  },

  /** 現在時刻を取得するユーティリティ（テストでモック差替可能） */
  _captureTimestamp: captureTimestamp,
} as const;
