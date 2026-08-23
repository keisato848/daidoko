import { RECIPE_TEXT_AI_PROMPT, parseRecipeText } from '../recipeTextParser';
import { recipeFormSchema } from '../../validation/recipe.schema';

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

/**
 * レシピ本・食品パッケージの書式。**空白で区切られていない。**
 * 見出しは「材料(2人前)」、材料は「じゃがいも……中2個」。この 2 つを扱えないと
 * 材料が 1 つも取れず、下書きが行き止まりになる（AQUOS で撮って発覚・2026-08-23）。
 */
describe('parseRecipeText: 紙面の書式', () => {
  it('人数つきの見出しを見出しとして扱い、人数も拾う', () => {
    const result = parseRecipeText(`材料(2人前)
じゃがいも 2個
作り方
1. 炒める`);
    expect(result.formData.servings).toBe(2);
    expect(result.formData.ingredients).toEqual([
      { name: 'じゃがいも', amount: '2個', groupLabel: '', note: '' },
    ]);
    expect(result.formData.steps.map((step) => step.body)).toEqual(['炒める']);
  });

  it('見出しの人数は全角括弧・空白区切りでも拾う', () => {
    expect(
      parseRecipeText(`材料（4人分）
玉ねぎ 1個`).formData.servings,
    ).toBe(4);
    expect(
      parseRecipeText(`材料 3人前
玉ねぎ 1個`).formData.servings,
    ).toBe(3);
  });

  it('リーダー（点線）で材料名と分量を分ける', () => {
    const result = parseRecipeText(`材料
じゃがいも(くし形切り)……中2個(300g)
サラダ油…………大さじ1`);
    expect(result.formData.ingredients).toEqual([
      { name: 'じゃがいも(くし形切り)', amount: '中2個(300g)', groupLabel: '', note: '' },
      { name: 'サラダ油', amount: '大さじ1', groupLabel: '', note: '' },
    ]);
  });

  it('OCR が点線をピリオド 1 個に潰しても分ける', () => {
    // 実測: ML Kit が「じゃがいも(くし形切り)……中2個(300g)」をこの形で返した
    const result = parseRecipeText(`材料
じゃがいも(くし形切り).中2個(300g)`);
    expect(result.formData.ingredients).toEqual([
      { name: 'じゃがいも(くし形切り)', amount: '中2個(300g)', groupLabel: '', note: '' },
    ]);
  });

  it('小数と空白区切りの行は点で割らない', () => {
    const result = parseRecipeText(`材料
サラダ油 大さじ1.5
塩.こしょう 少々`);
    expect(result.formData.ingredients).toEqual([
      { name: 'サラダ油', amount: '大さじ1.5', groupLabel: '', note: '' },
      { name: '塩.こしょう', amount: '少々', groupLabel: '', note: '' },
    ]);
  });

  it('中黒 1 つは区切りにしない（並列の材料名を割らない）', () => {
    const result = parseRecipeText(`材料
塩・こしょう 少々`);
    expect(result.formData.ingredients).toEqual([
      { name: '塩・こしょう', amount: '少々', groupLabel: '', note: '' },
    ]);
  });

  it('句点で手順を割らない', () => {
    const result = parseRecipeText(`材料
塩 少々
作り方
1. 炒めます。よく混ぜます。`);
    expect(result.formData.steps.map((step) => step.body)).toEqual(['炒めます。よく混ぜます。']);
  });
});

/**
 * **読めた項目は保存スキーマの上限を超えない。**
 * OCR は紙面の隅（原材料表示・賞味期限）まで拾うので、1 行でも上限を超えると
 * 保存でそこに詰まる。確認・編集の画面へ渡すのが目的なので、落とさず刈り込む。
 *
 * 逆に、読めなかった項目には**編集用の空行が 1 つ残る**（スキーマは通らない）。
 * だから確認画面へ進む条件を保存スキーマにしてはいけない — `ocr.agent` の
 * `hasUsableDraft()` 参照。
 */
describe('parseRecipeText: スキーマの上限', () => {
  it('長すぎる行を刈り込んでスキーマを通す', () => {
    const long = 'あ'.repeat(600);
    const result = parseRecipeText(`${long}
材料
${long} ${long}
作り方
1. ${long}`);
    expect(recipeFormSchema.safeParse(result.formData).success).toBe(true);
    expect(result.formData.title.length).toBe(100);
    expect(result.formData.ingredients[0].name.length).toBe(50);
    expect(result.formData.steps[0].body.length).toBe(500);
  });

  it('範囲外の人数・時間は読めなかった扱いにする', () => {
    const result = parseRecipeText(`カレー
300人分
調理時間 5000分
材料
塩 少々
作り方
1. 煮る`);
    expect(result.formData.servings).toBeUndefined();
    expect(result.formData.cookTimeMin).toBeUndefined();
    expect(recipeFormSchema.safeParse(result.formData).success).toBe(true);
  });
});
