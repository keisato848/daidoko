/**
 * A4: UrlFetchAgent — Server-side URL fetch + JSON-LD extraction
 * Fetches HTML from external recipe sites and normalizes to RecipeDraft
 */
import {
  extractJsonLdRecipe,
  extractSiteName,
  normalizeRecipeDraft,
  type RecipeDraft,
} from '../lib/jsonld.js';

export type AgentErrorCode =
  | 'UNSUPPORTED_SITE'
  | 'FETCH_FAILED'
  | 'PARSE_FAILED'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export interface AgentResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: AgentErrorCode; message: string; retryable: boolean };
}

const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; DaidokoBot/1.0; +https://daidoko.app/bot)';

async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function runUrlFetchAgent(url: string): Promise<AgentResult<RecipeDraft>> {
  // 1. Fetch HTML
  let html: string;
  try {
    html = await fetchWithTimeout(url);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: {
        code: 'FETCH_FAILED',
        message: isTimeout ? 'リクエストがタイムアウトしました' : 'ページの取得に失敗しました',
        retryable: true,
      },
    };
  }

  // 2. Extract JSON-LD Recipe
  const raw = extractJsonLdRecipe(html);
  if (!raw) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_SITE',
        message: 'このサイトからは自動取り込みできません（JSON-LD Recipe 非対応）',
        retryable: false,
      },
    };
  }

  // 3. Normalize
  try {
    const siteName = extractSiteName(html);
    const draft = normalizeRecipeDraft(raw, url, siteName);
    return { ok: true, data: draft };
  } catch {
    return {
      ok: false,
      error: {
        code: 'PARSE_FAILED',
        message: 'レシピデータの解析に失敗しました',
        retryable: false,
      },
    };
  }
}
