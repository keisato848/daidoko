/**
 * 写真パスの保存形式と解決（iOS 対応）。
 *
 * **DB には documentDirectory からの相対パスを保存する。**
 * 以前は `FileSystem.documentDirectory` を含む絶対パスをそのまま入れていたが、
 * iOS の documentDirectory は
 * `file:///var/mobile/Containers/Data/Application/<UUID>/Documents/` で、
 * **<UUID> は再インストール・アプリ更新・バックアップ復元で変わる**。
 * 古い絶対パスを描画すると `<Image>` は**エラーも出さずに何も描かない**うえ、
 * 絵文字のフォールバックは「パスが null のとき」しか出ないので**完全な空白**になる
 * （2026-08-13、App Store 用スクショの撮影で発覚）。Android の
 * `/data/user/0/<package>/files/` は不変なので、この問題は iOS だけで起きる。
 *
 * 保存済みの絶対パスも読み取り時に現在の documentDirectory へ貼り替えるので、
 * マイグレーション前でも表示は直る（自己修復）。
 */
import * as FileSystem from 'expo-file-system/legacy';

/** アプリが写真を置くサブディレクトリ。相対パスはこのいずれかで始まる。 */
export const PHOTO_DIRECTORIES = ['recipe-photos', 'cooking-photos'] as const;

const TAIL_PATTERN = new RegExp(`(?:^|/)((?:${PHOTO_DIRECTORIES.join('|')})/.+)$`);

/**
 * DB に保存する形（相対パス）へ正規化する。純粋関数。
 *
 * - 絶対パス（`file://…/Documents/recipe-photos/x.jpg`）→ `recipe-photos/x.jpg`
 * - すでに相対 → そのまま（冪等）
 * - 管理外の URI（`content://`・`asset://`・一時ファイル等）→ **そのまま返す**。
 *   これらは貼り替えると壊れるため、触らないのが正しい
 */
export function toStoredPhotoPath(path: string): string;
export function toStoredPhotoPath(path: null | undefined): null;
export function toStoredPhotoPath(path: string | null | undefined): string | null;
export function toStoredPhotoPath(path: string | null | undefined): string | null {
  if (path == null || path === '') return null;
  const matched = TAIL_PATTERN.exec(path);
  return matched?.[1] ?? path;
}

/**
 * 表示・ファイル操作に使う URI へ解決する。純粋関数にはできない
 * （documentDirectory を読むため）。
 *
 * 相対パスは現在の documentDirectory を前置し、**古い絶対パスも貼り替える**。
 * 管理外の URI はそのまま返す。
 */
export function resolvePhotoUri(path: string): string;
export function resolvePhotoUri(path: null | undefined): null;
export function resolvePhotoUri(path: string | null | undefined): string | null;
export function resolvePhotoUri(path: string | null | undefined): string | null {
  if (path == null || path === '') return null;
  const relative = toStoredPhotoPath(path);
  if (relative === null) return null;
  // 管理外（貼り替え対象ではない）ならそのまま
  if (!TAIL_PATTERN.test(`/${relative}`)) return path;
  const base = FileSystem.documentDirectory;
  if (!base) return path;
  return `${base}${relative}`;
}
