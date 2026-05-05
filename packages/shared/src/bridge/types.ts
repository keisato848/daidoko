/**
 * AgentBridge hook types — フック名・コンテキスト・ハンドラ型
 */
import type { AgentId } from '../types/agent';

/** フック名（全22種類） */
export type HookName =
  // Lifecycle
  | 'beforeAgentRun'
  | 'afterAgentRun'
  | 'onAgentError'
  | 'onAgentRetry'
  // DB
  | 'beforeDbRead'
  | 'afterDbRead'
  | 'beforeDbWrite'
  | 'afterDbWrite'
  | 'beforeMigration'
  | 'afterMigration'
  // External
  | 'beforeExternalFetch'
  | 'afterExternalFetch'
  | 'beforeAiCall'
  | 'afterAiCall'
  // Auth
  | 'beforeJwtVerify'
  | 'afterJwtVerify'
  | 'onTokenRefresh'
  | 'onAuthFailure'
  // Sync
  | 'beforeSyncFlush'
  | 'afterSyncFlush'
  | 'onSyncConflict'
  // FTS
  | 'beforeFtsSync'
  | 'afterFtsSync'
  | 'onIntegrityCheckFailed';

/** 全フック名の配列 */
export const ALL_HOOKS: HookName[] = [
  'beforeAgentRun',
  'afterAgentRun',
  'onAgentError',
  'onAgentRetry',
  'beforeDbRead',
  'afterDbRead',
  'beforeDbWrite',
  'afterDbWrite',
  'beforeMigration',
  'afterMigration',
  'beforeExternalFetch',
  'afterExternalFetch',
  'beforeAiCall',
  'afterAiCall',
  'beforeJwtVerify',
  'afterJwtVerify',
  'onTokenRefresh',
  'onAuthFailure',
  'beforeSyncFlush',
  'afterSyncFlush',
  'onSyncConflict',
  'beforeFtsSync',
  'afterFtsSync',
  'onIntegrityCheckFailed',
];

/** フックコンテキスト（各フック発火時に渡されるメタデータ） */
export interface HookContext<P = unknown> {
  hookName: HookName;
  agentId: AgentId;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  wallTime: string;
  perfMark: number;
  payload?: P;
}

/** フックハンドラ関数型 */
export type HookHandler<P = unknown> = (ctx: HookContext<P>) => void | Promise<void>;

/** ログレベル */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** ログエントリ */
export interface LogEntry {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  wallTime: string;
  perfMark: number;
  agentId: AgentId;
  hookName: HookName;
  level: LogLevel;
  durationMs?: number;
  payload?: Record<string, unknown>;
}

/** Bridge call options */
export interface BridgeCallOptions {
  traceId?: string;
  parentSpanId?: string;
  timeoutMs?: number;
}
