import { RECIPE_TEXT_AI_PROMPT, parseRecipeText } from '../recipeTextParser';

describe('parseRecipeText', () => {
  it('parses a heading-based Japanese recipe text', () => {
    const result = parseRecipeText(`
肉じゃが
4人分
調理時間 35分

材料
じゃがいも 3個
玉ねぎ 1個
牛こま肉 200g
しょうゆ 大さじ2

作り方
1. じゃがいもと玉ねぎを切る
2. 肉を炒めて野菜を加える
3. 調味料を入れて煮込む
`);

    expect(result.confidence).toBe('high');
    expect(result.formData.title).toBe('肉じゃが');
    expect(result.formData.servings).toBe(4);
    expect(result.formData.cookTimeMin).toBe(35);
    expect(result.formData.ingredients).toEqual([
      { name: 'じゃがいも', amount: '3個', groupLabel: '', note: '' },
      { name: '玉ねぎ', amount: '1個', groupLabel: '', note: '' },
      { name: '牛こま肉', amount: '200g', groupLabel: '', note: '' },
      { name: 'しょうゆ', amount: '大さじ2', groupLabel: '', note: '' },
    ]);
    expect(result.formData.steps.map((step) => step.body)).toEqual([
      'じゃがいもと玉ねぎを切る',
      '肉を炒めて野菜を加える',
      '調味料を入れて煮込む',
    ]);
  });

  it('parses freeform text without explicit section headings', () => {
    const result = parseRecipeText(`
豚汁
豚バラ肉 200g
大根 1/4本
にんじん 1本
味噌 大さじ3
1. 野菜を切る
2. 豚肉を炒める
3. だしで煮て味噌を溶く
`);

    expect(result.confidence).toBe('high');
    expect(result.formData.title).toBe('豚汁');
    expect(result.formData.ingredients.map((ingredient) => ingredient.name)).toEqual([
      '豚バラ肉',
      '大根',
      'にんじん',
      '味噌',
    ]);
    expect(result.formData.steps).toHaveLength(3);
  });

  it('extracts explicit title, prep time, and description notes', () => {
    const result = parseRecipeText(`
タイトル: だし巻き卵
下準備: 5分
材料:
卵 3個
だし 大さじ3
作り方:
① 卵液を混ぜる
② 少しずつ焼く
メモ:
弱火でゆっくり焼く
`);

    expect(result.formData.title).toBe('だし巻き卵');
    expect(result.formData.prepTimeMin).toBe(5);
    expect(result.formData.description).toBe('弱火でゆっくり焼く');
    expect(result.formData.steps.map((step) => step.body)).toEqual([
      '卵液を混ぜる',
      '少しずつ焼く',
    ]);
  });

  it('returns editable placeholder rows for sparse text', () => {
    const result = parseRecipeText('名前だけのレシピ');

    expect(result.confidence).toBe('low');
    expect(result.formData.title).toBe('名前だけのレシピ');
    expect(result.formData.ingredients).toEqual([
      { name: '', amount: '', groupLabel: '', note: '' },
    ]);
    expect(result.formData.steps).toEqual([{ body: '', timerSec: undefined }]);
  });

  it('手順本文の時間表現からタイマーを自動セットする (#77)', () => {
    const result = parseRecipeText(
      ['タイマーテスト', '', '材料', '豚肉 200g', '', '作り方', '1. 10分煮る', '2. 皿に盛る'].join(
        '\n',
      ),
    );
    expect(result.formData.steps[0].timerSec).toBe(600);
    expect(result.formData.steps[1].timerSec).toBeUndefined();
  });

  it('provides an AI prompt that asks for parser-friendly recipe text', () => {
    expect(RECIPE_TEXT_AI_PROMPT).toContain('料理名');
    expect(RECIPE_TEXT_AI_PROMPT).toContain('材料');
    expect(RECIPE_TEXT_AI_PROMPT).toContain('作り方');
    expect(RECIPE_TEXT_AI_PROMPT).toContain('JSON、表、Markdownの装飾、説明文は出力しない');
  });

  it('round-trips parser-friendly AI output into a save-ready draft', () => {
    const aiOutput = `鮭の味噌焼き
2人分
調理時間 20分
下準備 10分

材料
鮭 2切れ
味噌 大さじ2
みりん 大さじ1

作り方
1. 味噌とみりんを混ぜる
2. 鮭に塗って焼く

メモ
焦げないように弱めの火で焼く`;

    const result = parseRecipeText(aiOutput);

    expect(result.confidence).toBe('high');
    expect(result.formData).toMatchObject({
      title: '鮭の味噌焼き',
      servings: 2,
      cookTimeMin: 20,
      prepTimeMin: 10,
      description: '焦げないように弱めの火で焼く',
    });
    expect(result.formData.ingredients.map((ingredient) => ingredient.name)).toEqual([
      '鮭',
      '味噌',
      'みりん',
    ]);
    expect(result.formData.steps.map((step) => step.body)).toEqual([
      '味噌とみりんを混ぜる',
      '鮭に塗って焼く',
    ]);
  });
});

/**
 * 見出しに付いた人数。OCR や手書きの見出しは「肉じゃが（2人分）」の形が多く、
 * そのまま料理名にすると人数欄が空のまま料理名に「(2人分)」が残った（Pixel 9a・2026-08-23）。
 */
describe('parseRecipeText: 見出しの人数', () => {
  it('全角括弧の人数を料理名から分けて人数欄に入れる', () => {
    const result = parseRecipeText(`肉じゃが（2人分）

材料
じゃがいも 3個`);
    expect(result.formData.title).toBe('肉じゃが');
    expect(result.formData.servings).toBe(2);
  });

  it('半角括弧・括弧なしでも同じ', () => {
    expect(
      parseRecipeText(`肉じゃが(4人分)
材料
玉ねぎ 1個`).formData,
    ).toMatchObject({
      title: '肉じゃが',
      servings: 4,
    });
    expect(
      parseRecipeText(`肉じゃが 2人分
材料
玉ねぎ 1個`).formData,
    ).toMatchObject({
      title: '肉じゃが',
      servings: 2,
    });
  });

  it('「レシピ名:」の行でも分ける', () => {
    const result = parseRecipeText(`レシピ名: 鮭の味噌焼き（3人前）
材料
鮭 3切れ`);
    expect(result.formData).toMatchObject({ title: '鮭の味噌焼き', servings: 3 });
  });

  it('ラベル付きの人数行は見出しにしない', () => {
    const result = parseRecipeText(`材料: 2人分
じゃがいも 3個`);
    expect(result.formData.title).not.toContain('材料');
    expect(result.formData.servings).toBe(2);
  });

  it('人数の付いていない見出しはそのまま', () => {
    expect(
      parseRecipeText(`肉じゃが
材料
玉ねぎ 1個`).formData,
    ).toMatchObject({
      title: '肉じゃが',
      servings: undefined,
    });
  });
});
