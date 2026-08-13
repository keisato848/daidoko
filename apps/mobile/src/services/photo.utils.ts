import { resolvePhotoUri } from './photo-path';
import type { CookingPhotoItem } from './types';

/**
 * 調理写真をログ単位にまとめる。**ここが調理記録・タイムライン共通の出口**なので、
 * 表示用の URI 解決もここで行う（DB は相対パス。旧データの絶対パスも貼り替わる —
 * photo-path.ts）。`cloudUrl` は端末外の URL なので触らない。
 */
export function groupPhotosByLogId(
  photos: (CookingPhotoItem & { logId: string })[],
): Map<string, CookingPhotoItem[]> {
  const grouped = new Map<string, CookingPhotoItem[]>();
  for (const { logId, ...photo } of photos) {
    const current = grouped.get(logId) ?? [];
    current.push({ ...photo, localPath: resolvePhotoUri(photo.localPath) });
    grouped.set(logId, current);
  }
  return grouped;
}
