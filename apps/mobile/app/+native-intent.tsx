/**
 * 外から届くディープリンク（daidoko:// / https アプリリンク）のパス書き換え。
 *
 * 1.13.1 のナビ再編（N2・`docs/画面設計.md` §4-1）で、設定系の階層画面を
 * `(tabs)` グループからルート Stack（app/ 直下）へ移した。Expo Router の URL は
 * グループ名を含まないので `daidoko://settings` の形は移設後もそのまま解決するが、
 * グループ付きの旧形式 `daidoko://(tabs)/settings` を保存・共有していた場合に備えて
 * ここで新パスへ読み替える（旧ルートのファイルを残すと同じ URL に 2 ルートが
 * ぶつかるので、リダイレクト画面ではなくこの入口で書き換える）。
 */

/** (tabs) からルート Stack へ移した画面（menu はタブ側に残したので含めない）。 */
const MOVED_TO_ROOT_STACK = [
  'settings',
  'family',
  'backup',
  'share-status',
  'web-shares',
  'ai-key',
  'name-aliases',
  'menu-settings',
  'licenses',
  'book-edit',
  'cookable',
  'consume-meal',
  'receipt',
  'scan-barcode',
] as const;

// 末尾はクエリ（book-edit?id=… など）が続いてもよい
const LEGACY_TABS_PATH = new RegExp(`^/?\\(tabs\\)/(${MOVED_TO_ROOT_STACK.join('|')})((\\?|$).*)`);

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const match = LEGACY_TABS_PATH.exec(path);
  return match ? `/${match[1]}${match[2]}` : path;
}
