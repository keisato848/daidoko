import type { CookingPhotoItem } from './types';

export function groupPhotosByLogId(
  photos: (CookingPhotoItem & { logId: string })[],
): Map<string, CookingPhotoItem[]> {
  const grouped = new Map<string, CookingPhotoItem[]>();
  for (const { logId, ...photo } of photos) {
    const current = grouped.get(logId) ?? [];
    current.push(photo);
    grouped.set(logId, current);
  }
  return grouped;
}
