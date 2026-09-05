/**
 * AI が生成した「イメージ」（表紙）のラベル判定（docs/レシピ表紙AI生成設計.md §4）。
 *
 * 端末内・バックアップ・将来の同期では**ファイル名の接頭辞だけ**で運ぶ
 * （DB マイグレーション不要・`coverPhotoPath` と一緒に運ばれる）。
 * Web 共有だけは別経路（写真をバイト列で送るためファイル名が届かない）——
 * そちらは共有 payload の明示フィールド `coverIsAiGenerated` を使う
 * （`services/share.service.ts` 側で本ユーティリティを使って埋める）。
 *
 * 純関数。パスの形（相対 `recipe-photos/xxx.jpg` / 解決後の絶対 URI）を問わない
 * — ファイル名の basename だけ見るので、どちらで渡されても同じ判定になる。
 */

/** persistRecipePhoto の filenamePrefix に渡す接頭辞。 */
export const AI_GENERATED_PHOTO_PREFIX = 'aigen-';

export function isAiGeneratedPhoto(path: string | null | undefined): boolean {
  if (!path) return false;
  // クエリ・フラグメントを落としてから、パス区切り（'/' も '\' も）の最後の要素を見る
  const withoutQuery = path.split(/[?#]/)[0];
  const basename = withoutQuery.split(/[/\\]/).pop() ?? '';
  return basename.startsWith(AI_GENERATED_PHOTO_PREFIX);
}
