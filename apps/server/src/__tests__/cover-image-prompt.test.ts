/**
 * `buildCoverImagePrompt` の栓 `COVER_IMAGE_CUISINE_HINT`（Issue #313・
 * `docs/レシピ表紙AI生成設計.md` §2-1「プロンプト（C-1・2026-09-13）」）。
 *
 * 守りたいのは 3 つ。
 * 1. 栓が off（未設定・`0`・`false`）なら、プロンプトは**現行と 1 文字も変わらない**。
 *    「現行」は実装から import せず、このファイルのリテラルで固定する
 *    （実装の値と比べるだけの assertion は実装をコピーしただけになる）。
 * 2. 栓が on で出自が決まれば、**盛り付けの 1 行だけ**が `platingLineFor` の行に差し替わる。
 *    それ以外の行は off と同一。
 * 3. 栓が on でも判定不能なら現行の locale 行にフォールバックする。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCoverImagePrompt, type CoverImageInput } from '../lib/cover-image.js';
import { platingLineFor, type Cuisine } from '../lib/cuisine.js';
import type { OutputLocale } from '../lib/output-locale.js';

const ENV_KEY = 'COVER_IMAGE_CUISINE_HINT';
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

/** 現行（main）の固定部分。ここを実装から import してはいけない。 */
const CURRENT_CONSTRAINTS =
  '材料リストに無い食材を描き足さない。 文字・ロゴ・透かし・人物・手を描かない。 実在する店舗名・ブランド名を描かない。 写真のような自然な質感で、家庭の食卓に出せる一皿として構図をまとめる。';
const CURRENT_PLATING_JA = '日本の家庭の食卓に出てくるような、自然な盛り付けにする。';
const CURRENT_PLATING_EN =
  'Plate and style it the way it would naturally look on a table in an English-speaking household.';

/** 出自が japanese に決まる入力（タグで決まる）。栓が効いていないと行が変わるので、off の検証に使う。 */
const JAPANESE_INPUT: CoverImageInput = {
  title: '肉じゃが',
  ingredientNames: ['じゃがいも', '牛肉', 'みりん'],
  tags: ['和食'],
};

/** 出自が western に決まる入力（タグ無し・料理名の部分一致）。 */
const WESTERN_INPUT: CoverImageInput = {
  title: '煮込みハンバーグ',
  ingredientNames: ['合いびき肉', '玉ねぎ', 'デミグラスソース'],
  tags: [],
};

/** どの段でも決まらない入力。 */
const UNKNOWN_INPUT: CoverImageInput = {
  title: '野菜炒め',
  ingredientNames: ['鶏肉', '玉ねぎ', '塩'],
  tags: [],
};

const CURRENT_JAPANESE_JA = [
  '料理名: 肉じゃが',
  '使われている材料: じゃがいも、牛肉、みりん',
  'タグ: 和食',
  '',
  'この料理のできあがりを写真のように 1 枚描いてください。',
  CURRENT_CONSTRAINTS,
  CURRENT_PLATING_JA,
].join('\n');

const CURRENT_JAPANESE_EN = [
  '料理名: 肉じゃが',
  '使われている材料: じゃがいも、牛肉、みりん',
  'タグ: 和食',
  '',
  'この料理のできあがりを写真のように 1 枚描いてください。',
  CURRENT_CONSTRAINTS,
  CURRENT_PLATING_EN,
].join('\n');

describe('COVER_IMAGE_CUISINE_HINT off — 現行と 1 文字も変わらない', () => {
  it.each([
    ['未設定', undefined],
    ['0', '0'],
    ['false', 'false'],
  ])('%s: ja（outputLocale 省略）', (_label, value) => {
    if (value !== undefined) process.env[ENV_KEY] = value;
    expect(buildCoverImagePrompt(JAPANESE_INPUT)).toBe(CURRENT_JAPANESE_JA);
  });

  it.each([
    ['未設定', undefined],
    ['0', '0'],
    ['false', 'false'],
  ])('%s: en', (_label, value) => {
    if (value !== undefined) process.env[ENV_KEY] = value;
    expect(buildCoverImagePrompt({ ...JAPANESE_INPUT, outputLocale: 'en' })).toBe(
      CURRENT_JAPANESE_EN,
    );
  });

  it('off: 材料・タグが空なら行そのものが出ない（現行どおり）', () => {
    expect(buildCoverImagePrompt({ title: '野菜炒め', ingredientNames: [], tags: [] })).toBe(
      [
        '料理名: 野菜炒め',
        '',
        'この料理のできあがりを写真のように 1 枚描いてください。',
        CURRENT_CONSTRAINTS,
        CURRENT_PLATING_JA,
      ].join('\n'),
    );
  });
});

describe('COVER_IMAGE_CUISINE_HINT on — 盛り付けの 1 行だけが出自の行に差し替わる', () => {
  const cases: Array<[OutputLocale, string, CoverImageInput, Cuisine, string, string]> = [
    ['ja', '和食', JAPANESE_INPUT, 'japanese', CURRENT_PLATING_JA, '和食器'],
    ['en', '和食', JAPANESE_INPUT, 'japanese', CURRENT_PLATING_EN, 'Japanese'],
    ['ja', '洋食', WESTERN_INPUT, 'western', CURRENT_PLATING_JA, '洋食'],
    ['en', '洋食', WESTERN_INPUT, 'western', CURRENT_PLATING_EN, 'Western'],
  ];

  it.each(cases)(
    'locale=%s × %s: 末尾が platingLineFor の行で、それ以外の行は off と同一',
    (locale, _label, input, cuisine, currentLine, keyword) => {
      const off = buildCoverImagePrompt({ ...input, outputLocale: locale });
      process.env[ENV_KEY] = '1';
      const on = buildCoverImagePrompt({ ...input, outputLocale: locale });

      const offLines = off.split('\n');
      const onLines = on.split('\n');
      expect(onLines.length).toBe(offLines.length);
      expect(onLines.slice(0, -1)).toEqual(offLines.slice(0, -1));

      const last = onLines[onLines.length - 1];
      expect(last).toBe(platingLineFor(cuisine, locale));
      expect(last).toContain(keyword);
      expect(last).not.toBe(currentLine);
    },
  );

  it.each([['1'], ['true'], ['on'], [' TRUE ']])('真の書き方 %j で有効になる', (value) => {
    process.env[ENV_KEY] = value;
    expect(buildCoverImagePrompt(JAPANESE_INPUT)).not.toContain(CURRENT_PLATING_JA);
    expect(buildCoverImagePrompt(JAPANESE_INPUT).endsWith(platingLineFor('japanese', 'ja'))).toBe(
      true,
    );
  });

  it('yes / 2 のような未定義の値は off 扱い', () => {
    process.env[ENV_KEY] = 'yes';
    expect(buildCoverImagePrompt(JAPANESE_INPUT)).toBe(CURRENT_JAPANESE_JA);
    process.env[ENV_KEY] = '2';
    expect(buildCoverImagePrompt(JAPANESE_INPUT)).toBe(CURRENT_JAPANESE_JA);
  });
});

describe('COVER_IMAGE_CUISINE_HINT on — 判定不能なら現行の locale 行にフォールバック', () => {
  it('ja: 現行の日本語行で終わる', () => {
    process.env[ENV_KEY] = '1';
    expect(buildCoverImagePrompt(UNKNOWN_INPUT)).toBe(
      [
        '料理名: 野菜炒め',
        '使われている材料: 鶏肉、玉ねぎ、塩',
        '',
        'この料理のできあがりを写真のように 1 枚描いてください。',
        CURRENT_CONSTRAINTS,
        CURRENT_PLATING_JA,
      ].join('\n'),
    );
  });

  it('en: 現行の英語行で終わる', () => {
    process.env[ENV_KEY] = '1';
    expect(buildCoverImagePrompt({ ...UNKNOWN_INPUT, outputLocale: 'en' })).toBe(
      [
        '料理名: 野菜炒め',
        '使われている材料: 鶏肉、玉ねぎ、塩',
        '',
        'この料理のできあがりを写真のように 1 枚描いてください。',
        CURRENT_CONSTRAINTS,
        CURRENT_PLATING_EN,
      ].join('\n'),
    );
  });
});

describe('entry はプロンプトに載らない', () => {
  const flags: Array<[string, string | undefined]> = [
    ['off', undefined],
    ['on', '1'],
  ];
  it.each(flags)(
    '栓 %s: 余分な entry キーが混ざっても、プロンプトは title/材料/タグ/locale だけで決まる',
    (_label, value) => {
      if (value !== undefined) process.env[ENV_KEY] = value;
      const plain = buildCoverImagePrompt(JAPANESE_INPUT);
      // ルートは entry を CoverImageInput に載せない設計だが、万一載っても文面に出ないことを固定する
      const withEntry = buildCoverImagePrompt({
        ...JAPANESE_INPUT,
        entry: 'detail',
      } as CoverImageInput);
      expect(withEntry).toBe(plain);
      expect(withEntry).not.toContain('entry');
      expect(withEntry).not.toContain('detail');
    },
  );
});
