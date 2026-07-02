import type { CookingPhotoItem, TimelineEntry } from '../../services/types';
import { flattenGalleryPhotos } from '../gallery';

function photo(id: string, overrides: Partial<CookingPhotoItem> = {}): CookingPhotoItem {
  return {
    id,
    localPath: `/local/${id}.jpg`,
    cloudUrl: null,
    sortOrder: 0,
    takenAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function entry(cookedAt: string, photos: CookingPhotoItem[]): TimelineEntry {
  return {
    id: `log-${cookedAt}`,
    recipeId: 'r1',
    recipeTitle: '肉じゃが',
    userName: '恵',
    cookedAt,
    servings: null,
    rating: null,
    memo: null,
    photos,
  };
}

describe('flattenGalleryPhotos', () => {
  it('全ログの写真を1リストに展開する', () => {
    const result = flattenGalleryPhotos([
      entry('2026-06-07T09:00:00.000Z', [photo('a'), photo('b')]),
      entry('2026-06-08T09:00:00.000Z', [photo('c')]),
    ]);
    expect(result).toHaveLength(3);
  });

  it('新しい調理日順に並べる', () => {
    const result = flattenGalleryPhotos([
      entry('2026-06-01T00:00:00.000Z', [photo('old')]),
      entry('2026-06-09T00:00:00.000Z', [photo('new')]),
    ]);
    expect(result[0].id).toBe('new');
    expect(result[1].id).toBe('old');
  });

  it('cloudUrl があれば優先、無ければ localPath', () => {
    const result = flattenGalleryPhotos([
      entry('2026-06-07T09:00:00.000Z', [
        photo('a', { cloudUrl: 'https://cdn/a.jpg' }),
        photo('b'),
      ]),
    ]);
    const a = result.find((p) => p.id === 'a');
    const b = result.find((p) => p.id === 'b');
    expect(a?.uri).toBe('https://cdn/a.jpg');
    expect(b?.uri).toBe('/local/b.jpg');
  });

  it('写真の無いログは無視、レシピ参照を保持', () => {
    const result = flattenGalleryPhotos([
      entry('2026-06-07T09:00:00.000Z', []),
      entry('2026-06-08T09:00:00.000Z', [photo('c')]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].recipeId).toBe('r1');
    expect(result[0].recipeTitle).toBe('肉じゃが');
  });
});
