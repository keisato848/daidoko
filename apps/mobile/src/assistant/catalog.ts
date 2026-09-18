/**
 * 操作カタログ — アシスタントが実行できる操作の登録簿。
 *
 * `tier` は `'navigate' | 'mutate'` の 2 段階のみ。
 * 破壊的操作 (`'destructive'`) は**型に存在しない**ため、
 * コンパイル時点で登録を弾ける（`docs/AIに聞く設計.md` §5 の方針）。
 *
 * v1 では `shopping.add`（買い物リストに足す）1 件だけを登録する。
 */

// ---------------------------------------------------------------------------
// Catalog entry type
// ---------------------------------------------------------------------------

/** 操作の安全性ランク。destructive は意図的に含めない（型で塞ぐ） */
export type CatalogTier = 'navigate' | 'mutate';

export interface CatalogEntry {
  /** ドット区切りの一意 ID（例: `'shopping.add'`） */
  id: string;
  /** 安全性ランク */
  tier: CatalogTier;
}

// ---------------------------------------------------------------------------
// Catalog registry
// ---------------------------------------------------------------------------

const catalog: ReadonlyMap<string, CatalogEntry> = new Map<string, CatalogEntry>([
  ['shopping.add', { id: 'shopping.add', tier: 'mutate' }],
]);

/** カタログからエントリを引く。無ければ `undefined`。 */
export function lookupCatalog(id: string): CatalogEntry | undefined {
  return catalog.get(id);
}
