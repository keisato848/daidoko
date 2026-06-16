/**
 * Pure helper for the cooking-photo gallery view (利用フロー §5)
 */
import type { TimelineEntry } from '../services/types';

export interface GalleryPhoto {
  id: string;
  uri: string;
  recipeId: string | null;
  recipeTitle: string;
  cookedAt: string;
}

/**
 * Flatten all cooking-log photos across timeline entries into a single list,
 * newest first, each carrying a back-reference to its recipe/log.
 */
export function flattenGalleryPhotos(entries: TimelineEntry[]): GalleryPhoto[] {
  const photos: GalleryPhoto[] = [];
  for (const entry of entries) {
    for (const photo of entry.photos) {
      photos.push({
        id: photo.id,
        uri: photo.cloudUrl ?? photo.localPath,
        recipeId: entry.recipeId,
        recipeTitle: entry.recipeTitle,
        cookedAt: entry.cookedAt,
      });
    }
  }
  return photos.sort((a, b) => b.cookedAt.localeCompare(a.cookedAt));
}
