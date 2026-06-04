/**
 * Agent shared types — A1〜A8 エージェント共通型定義
 */

/** エージェント ID */
export type AgentId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8';

/** エージェント名マッピング */
export const AGENT_NAMES: Record<AgentId, string> = {
  A1: 'ImportAgent',
  A2: 'OCRAgent',
  A3: 'SyncAgent',
  A4: 'UrlFetchAgent',
  A5: 'AIStructureAgent',
  A6: 'SyncProcessorAgent',
  A7: 'SecurityAgent',
  A8: 'DatabaseAgent',
} as const;

/** エージェントエラーコード */
export type AgentErrorCode =
  | 'UNSUPPORTED_SITE'
  | 'FETCH_FAILED'
  | 'PARSE_FAILED'
  | 'AI_API_UNAVAILABLE'
  | 'OCR_FAILED'
  | 'PHOTO_RECIPE_FAILED'
  | 'SYNC_CONFLICT'
  | 'NETWORK_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TOKEN_EXPIRED'
  | 'MIGRATION_FAILED'
  | 'DB_INTEGRITY_ERROR'
  | 'FTS_REBUILD_FAILED'
  | 'UNKNOWN';

/** エージェントエラー */
export interface AgentError {
  code: AgentErrorCode;
  message: string;
  retryable: boolean;
}

/** エージェント実行結果 */
export interface AgentResult<T> {
  ok: boolean;
  data?: T;
  error?: AgentError;
}

/** エージェント実行関数型 */
export type AgentRunner<I, O> = (input: I) => Promise<AgentResult<O>>;
