/**
 * 共有リンクをアプリで開く（#198）。
 *
 * `https://<server>/r/:slug` / `/b/:slug` を OS がアプリへ渡してきたら、閲覧ページではなく
 * **取り込み画面**を出す。中身はサーバーの JSON（`/api/v1/share/recipes/:slug` 等）から取る。
 * いきなり保存はしない — URL 取り込みと同じで、利用者が確認してから保存する。
 *
 * アプリが入っていない人はこれまでどおり Web ページ（App Links はインストール済みの
 * ときだけアプリへ行く）。
 */
import { API_V1 } from '../config';

export interface SharedRecipeJson {
  slug: string;
  title: string;
  servings: number | null;
  cookTimeMin: number | null;
  description: string | null;
  locale: string;
  ingredients: { name: string; amount?: string; note?: string; groupLabel?: string }[];
  steps: { body: string }[];
  tags: string[];
  hasPhoto: boolean;
  /**
   * 中身が AI 由来か（#266）。**省略可** — 旧サーバーは返さない。
   * 未定義は「AI ではない」ではなく「分からない」。
   */
  aiGenerated?: boolean;
}

export interface SharedBookJson {
  slug: string;
  title: string;
  description: string | null;
  locale: string;
  recipes: Omit<SharedRecipeJson, 'slug' | 'locale' | 'hasPhoto'>[];
}

export type ShareImportErrorCode =
  | 'NOT_FOUND'
  | 'PASSCODE_REQUIRED'
  | 'PASSCODE_WRONG'
  | 'PASSCODE_LOCKED'
  | 'NETWORK'
  | 'SERVER';

export class ShareImportError extends Error {
  constructor(public readonly code: ShareImportErrorCode) {
    super(code);
    this.name = 'ShareImportError';
  }
}

/** 共有リンクの URL から種別と slug を取り出す。共有リンクでなければ null */
export function parseShareLink(url: string): { kind: 'recipe' | 'book'; slug: string } | null {
  const match = /\/(r|b)\/([A-Za-z0-9_-]{4,64})(?:[/?#]|$)/.exec(url);
  if (!match) return null;
  return { kind: match[1] === 'r' ? 'recipe' : 'book', slug: match[2] ?? '' };
}

async function request<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_V1}/share${path}`, { headers });
  } catch {
    throw new ShareImportError('NETWORK');
  }
  let json: { ok?: boolean; error?: string; data?: T } | null = null;
  try {
    json = (await res.json()) as { ok?: boolean; error?: string; data?: T };
  } catch {
    json = null;
  }
  if (res.ok && json?.ok && json.data) return json.data;
  const code = json?.error;
  if (res.status === 404) throw new ShareImportError('NOT_FOUND');
  if (code === 'PASSCODE_REQUIRED' || code === 'PASSCODE_WRONG' || code === 'PASSCODE_LOCKED') {
    throw new ShareImportError(code);
  }
  throw new ShareImportError('SERVER');
}

export function fetchSharedRecipe(slug: string): Promise<SharedRecipeJson> {
  return request<SharedRecipeJson>(`/recipes/${encodeURIComponent(slug)}`);
}

export function fetchSharedBook(slug: string, passcode?: string): Promise<SharedBookJson> {
  return request<SharedBookJson>(
    `/books/${encodeURIComponent(slug)}`,
    passcode ? { 'x-share-passcode': passcode } : {},
  );
}
