/**
 * Web 共有の純粋ロジック。ここで守るもの:
 * - 出所ゲート: URL 取り込み由来（type='url'）が 1 つでもあれば共有不可
 *   （転載をサーバーに保存しない — docs/Web共有設計.md §2-2）
 * - ペイロード: attested が必ず true で載る（確認ダイアログ通過の証跡）
 */
import {
  buildShareRecipeBody,
  buildSharePayload,
  shareBlockReasonForSourceTypes,
} from '../web-share.service';
import type { RecipeDetail } from '../types';

describe('shareBlockReasonForSourceTypes', () => {
  it('URL 取り込み由来が 1 つでもあれば共有不可', () => {
    expect(shareBlockReasonForSourceTypes(['url'])).toBe('url-import');
    // 編集で新リビジョンができても、過去リビジョンの出所が残っていれば塞ぐ
    expect(shareBlockReasonForSourceTypes(['url', 'photo'])).toBe('url-import');
  });

  it('手動・写真AI・OCR は共有できる（attestation は別途）', () => {
    expect(shareBlockReasonForSourceTypes([])).toBeNull();
    expect(shareBlockReasonForSourceTypes(['photo', 'ocr', 'manual'])).toBeNull();
    expect(shareBlockReasonForSourceTypes([null])).toBeNull();
  });
});

describe('buildSharePayload', () => {
  const recipe: RecipeDetail = {
    id: 'r1',
    title: '肉じゃが',
    titleReading: 'にくじゃが',
    servings: 4,
    prepTimeMin: null,
    cookTimeMin: 30,
    description: ' 甘めの味付け ',
    rating: null,
    tags: ['和食'],
    ingredients: [
      { id: 'i1', name: 'じゃがいも', amount: '3個', note: null, groupLabel: null },
      { id: 'i2', name: '醤油', amount: '大さじ2', note: '減塩', groupLabel: '調味料' },
    ] as RecipeDetail['ingredients'],
    steps: [{ id: 's1', body: '切る', timerSec: null }] as RecipeDetail['steps'],
    heroPhotoUri: null,
    coverPhotoPath: null,
    isCoverAiGenerated: false,
    isAiGenerated: false,
    pinnedAt: null,
    placeName: null,
  };

  it('coverIsAiGenerated は省略される（表紙が AI 生成でないとき）', () => {
    expect(buildSharePayload(recipe, 'ja').coverIsAiGenerated).toBeUndefined();
  });

  it('coverIsAiGenerated: true が乗る（表紙が AI 生成イメージのとき）', () => {
    const payload = buildSharePayload({ ...recipe, isCoverAiGenerated: true }, 'ja');
    expect(payload.coverIsAiGenerated).toBe(true);
  });

  it('aiGenerated は省略される（中身が AI 由来でないとき）', () => {
    expect(buildSharePayload(recipe, 'ja').aiGenerated).toBeUndefined();
  });

  it('aiGenerated: true が乗る（中身が AI 推定のとき・#266）', () => {
    const payload = buildSharePayload({ ...recipe, isAiGenerated: true }, 'ja');
    expect(payload.aiGenerated).toBe(true);
  });

  it('attested: true が必ず載る（確認ダイアログ通過後にのみ呼ばれる前提）', () => {
    expect(buildSharePayload(recipe, 'ja').attested).toBe(true);
  });

  it('レシピの内容とロケールがそのまま写る（空フィールドは省略）', () => {
    const payload = buildSharePayload(recipe, 'en');
    expect(payload.locale).toBe('en');
    expect(payload.title).toBe('肉じゃが');
    expect(payload.servings).toBe(4);
    expect(payload.cookTimeMin).toBe(30);
    expect(payload.description).toBe('甘めの味付け'); // trim される
    expect(payload.ingredients).toEqual([
      { name: 'じゃがいも', amount: '3個' },
      { name: '醤油', amount: '大さじ2', note: '減塩', groupLabel: '調味料' },
    ]);
    expect(payload.steps).toEqual([{ body: '切る' }]);
    expect(payload.tags).toEqual(['和食']);
  });

  it('servings・説明が無いレシピではキー自体を載せない', () => {
    const bare = { ...recipe, servings: null, cookTimeMin: null, description: null };
    const payload = buildSharePayload(bare, 'ja');
    expect('servings' in payload).toBe(false);
    expect('cookTimeMin' in payload).toBe(false);
    expect('description' in payload).toBe(false);
  });

  it('帖用の本文（buildShareRecipeBody）には attested / locale が載らない — 帖側で1回だけ付く', () => {
    const body = buildShareRecipeBody(recipe);
    expect('attested' in body).toBe(false);
    expect('locale' in body).toBe(false);
    expect(body.title).toBe('肉じゃが');
    expect(body.ingredients).toHaveLength(2);
  });
});
