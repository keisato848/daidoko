/**
 * #220 の回帰。**出荷される規則そのものを直接叩く。**
 *
 * `recipe.service.test.ts` の同名テストは `isNativePlatform: false` のモックを敷くので
 * `db/mock.ts` しか通らない。規則を手写しで二重化していた頃は、
 * **実装側だけ #220 に戻しても 916 件が緑のまま**だった。
 * この規則は分岐の手前にある純関数なので、ここのテストは両経路を同時に守る。
 */
import { resolveRecipeUpdate, type RecipeUpdateCurrent } from '../recipe-update';

jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/' }));

const CURRENT: RecipeUpdateCurrent = {
  titleReading: 'にくじゃが',
  coverPhotoPath: 'recipe-photos/before.jpg',
  placeName: 'おふくろの味',
  revision: {
    servings: 4,
    cookTimeMin: 40,
    prepTimeMin: 15,
    description: '定番の煮物',
    sourceId: 'source-1',
  },
};

const MINIMAL = {
  title: '肉じゃが',
  ingredients: [{ name: 'じゃがいも' }],
  steps: [{ body: '煮る' }],
  tags: [],
};

describe('resolveRecipeUpdate', () => {
  it('渡されなかった欄は現行値を引き継ぐ（refine のように一部だけ渡す）', () => {
    const next = resolveRecipeUpdate(MINIMAL, CURRENT);

    expect(next).toEqual({
      titleReading: 'にくじゃが',
      coverPhotoPath: 'recipe-photos/before.jpg',
      placeName: 'おふくろの味',
      servings: 4,
      cookTimeMin: 40,
      prepTimeMin: 15,
      description: '定番の煮物',
      sourceId: 'source-1',
    });
  });

  it('明示的に null を渡した欄は消える（編集画面のように全欄を渡す）', () => {
    const next = resolveRecipeUpdate(
      {
        ...MINIMAL,
        titleReading: null,
        placeName: null,
        coverPhotoPath: null,
        servings: null,
        cookTimeMin: null,
        prepTimeMin: null,
        description: null,
      },
      CURRENT,
    );

    expect(next).toMatchObject({
      titleReading: null,
      placeName: null,
      coverPhotoPath: null,
      servings: null,
      cookTimeMin: null,
      prepTimeMin: null,
      description: null,
    });
  });

  it('空文字も「消す」として扱う（フォームが空欄を空文字で返すため）', () => {
    const next = resolveRecipeUpdate(
      { ...MINIMAL, titleReading: '', placeName: '   ', description: '' },
      CURRENT,
    );

    expect(next.titleReading).toBeNull();
    expect(next.placeName).toBeNull();
    expect(next.description).toBeNull();
  });

  it('渡された値は前後の空白を落として採用する', () => {
    const next = resolveRecipeUpdate(
      { ...MINIMAL, titleReading: '  にくじゃが改  ', placeName: ' 新しい店 ' },
      CURRENT,
    );

    expect(next.titleReading).toBe('にくじゃが改');
    expect(next.placeName).toBe('新しい店');
  });

  it('表紙写真は DB 保存形（相対パス）へ正規化する', () => {
    const next = resolveRecipeUpdate(
      { ...MINIMAL, coverPhotoPath: 'file:///documents/recipe-photos/after.jpg' },
      CURRENT,
    );

    expect(next.coverPhotoPath).toBe('recipe-photos/after.jpg');
  });

  it('出所は渡されなくても必ず引き継ぐ（Web 共有の出所ゲートの土台）', () => {
    expect(resolveRecipeUpdate(MINIMAL, CURRENT).sourceId).toBe('source-1');
  });

  it('現行リビジョンが無くても落ちない（同期で currentRevId が null になり得る）', () => {
    const next = resolveRecipeUpdate(MINIMAL, { ...CURRENT, revision: null });

    expect(next).toMatchObject({
      titleReading: 'にくじゃが',
      servings: null,
      cookTimeMin: null,
      prepTimeMin: null,
      description: null,
      sourceId: null,
    });
  });

  it('数値の 0 は「消す」ではなくそのまま採用する（?? に潰さない）', () => {
    // 人数は zod で min(1) なので実際には来ないが、規則としては値として扱う
    expect(resolveRecipeUpdate({ ...MINIMAL, servings: 0 }, CURRENT).servings).toBe(0);
  });
});
