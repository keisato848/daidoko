/**
 * A1: ImportAgent — Mobile-side URL import orchestrator
 * Validates URL, calls server /api/v1/import/url, returns RecipeDraft
 */
import { API_V1 } from '../config';

export interface RecipeDraft {
  title: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  prepTimeMin?: number;
  ingredients: { name: string; amount?: string }[];
  steps: { body: string }[];
  sourceUrl?: string;
  sourceName?: string;
  confidence: 'high' | 'medium' | 'low';
}

export type ImportErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_SITE'
  | 'FETCH_FAILED'
  | 'NETWORK_UNAVAILABLE'
  | 'PARSE_FAILED'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export interface ImportResult {
  ok: boolean;
  data?: RecipeDraft;
  error?: { code: ImportErrorCode; message: string; retryable: boolean };
}

const TIMEOUT_MS = 15_000;

function validateUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return 'URLを入力してください';
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))
    return 'URLはhttpまたはhttpsで始めてください';
  if (trimmed.length > 2048) return 'URLが長すぎます';
  return null;
}

export async function runImportAgent(url: string, signal?: AbortSignal): Promise<ImportResult> {
  const validationError = validateUrl(url);
  if (validationError) {
    return {
      ok: false,
      error: { code: 'INVALID_URL', message: validationError, retryable: false },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const combinedSignal = signal ?? controller.signal;

  try {
    const res = await fetch(`${API_V1}/import/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
      signal: combinedSignal,
    });

    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: 'FETCH_FAILED',
          message: `サーバーエラー (${res.status})`,
          retryable: res.status >= 500,
        },
      };
    }

    const result = (await res.json()) as ImportResult;
    return result;
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return {
          ok: false,
          error: {
            code: 'FETCH_FAILED',
            message: 'リクエストがタイムアウトしました',
            retryable: true,
          },
        };
      }
      if (err.message.toLowerCase().includes('network') || err.message.includes('fetch')) {
        return {
          ok: false,
          error: {
            code: 'NETWORK_UNAVAILABLE',
            message: 'インターネット接続を確認してください',
            retryable: true,
          },
        };
      }
    }
    return {
      ok: false,
      error: { code: 'UNKNOWN', message: '予期しないエラーが発生しました', retryable: false },
    };
  } finally {
    clearTimeout(timer);
  }
}
