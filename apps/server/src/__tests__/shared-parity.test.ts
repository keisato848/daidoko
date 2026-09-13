/**
 * 契約の正（@daidoko/shared）とサーバー側の写しの突合。
 *
 * サーバーは実行時に shared を取り込まない方針（tsconfig の rootDir が src に
 * 閉じている = `import '@daidoko/shared'` は TS6059 で型検査を通らない）ため、
 * 上限値・語彙リストは lib 側に写しがある。写しがズレると「契約テストは緑なのに
 * 本番で 400」型の事故になる（冷蔵庫写真の実機 400・2026-09-05）。
 * このテストは shared の**ソースをテキストとして読み**、写しと突き合わせる —
 * import できない制約の中で、ズレたら割れる唯一の網。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CATEGORY_NAME_WORDS as SERVER_CATEGORY_NAME_WORDS } from '../lib/fridge-vision.js';
import {
  CUISINES as SERVER_CUISINES,
  CUISINE_TAG_WORDS as SERVER_CUISINE_TAG_WORDS,
  CUISINE_TITLE_WORDS as SERVER_CUISINE_TITLE_WORDS,
  CUISINE_INGREDIENT_WORDS as SERVER_CUISINE_INGREDIENT_WORDS,
  platingLineFor as serverPlatingLineFor,
  type Cuisine,
} from '../lib/cuisine.js';
import { MAX_IMAGE_BASE64_LENGTH } from '../routes/infer.js';

/**
 * ソースを読むときは**改行コードを潰す**。このリポジトリには `.gitattributes` が無く、
 * Windows では `core.autocrlf=true` で CRLF、CI（Linux）では LF で checkout される。
 * 生のまま比べると「片方だけ CRLF」で割れて、写しの中身は同じなのに赤くなる
 * （2026-09-13 に実際に踏んだ）。比べたいのは中身であって改行ではない。
 */
function readSource(...segments: string[]): string {
  return readFileSync(resolve(__dirname, ...segments), 'utf8').replace(/\r\n/g, '\n');
}

const SHARED_AI_CONSTANTS = readSource('../../../../packages/shared/src/constants/ai.ts');

const SHARED_CUISINE = readSource('../../../../packages/shared/src/constants/cuisine.ts');

const SERVER_CUISINE_SOURCE = readSource('../lib/cuisine.ts');

const SERVER_FRIDGE_VISION_SOURCE = readSource('../lib/fridge-vision.ts');

/**
 * shared 側のソースから `Record<Cuisine, readonly string[]>` の語彙表を**テキストとして**
 * 取り出す。import できない制約の中で写しのズレを割る唯一の網（ファイル冒頭のコメント参照）。
 */
function sharedWordTable(name: string): Record<string, string[]> {
  const head = `export const ${name}: Record<Cuisine, readonly string[]> = {`;
  const from = SHARED_CUISINE.indexOf(head);
  expect(from, `${name} が shared に見つからない`).toBeGreaterThanOrEqual(0);
  const bodyStart = from + head.length;
  const bodyEnd = SHARED_CUISINE.indexOf('\n};', bodyStart);
  expect(bodyEnd, `${name} の終端が見つからない`).toBeGreaterThan(bodyStart);
  const body = SHARED_CUISINE.slice(bodyStart, bodyEnd);

  const table: Record<string, string[]> = {};
  for (const entry of body.matchAll(/^ {2}(\w+): \[([\s\S]*?)\],$/gm)) {
    table[entry[1]] = [...entry[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }
  return table;
}

const SHARED_STEP_IMAGE = readSource('../../../../packages/shared/src/constants/step-image.ts');
const SERVER_STEP_IMAGE = readSource('../lib/step-image.ts');

/**
 * 手順のイラストのプロンプトは shared が正・`lib/step-image.ts` が写し（設計 §8-3）。
 * 語彙の突合では足りない — 縛りの**文面**と、手順番号を渡す組み立てまで同じである必要がある。
 * 写しは「`StepImagePromptInput` の宣言から `buildStepImagePrompt` の末尾まで」を
 * そのまま貼ったものなので、その区画を丸ごと比べる。
 */
function stepImagePromptRegion(source: string, label: string): string {
  const from = source.indexOf('/** プロンプトの材料。');
  expect(from, `${label}: 区画の先頭が見つからない`).toBeGreaterThanOrEqual(0);
  const fnAt = source.indexOf('export function buildStepImagePrompt', from);
  expect(fnAt, `${label}: buildStepImagePrompt が見つからない`).toBeGreaterThan(from);
  const to = source.indexOf('\n}\n', fnAt);
  expect(to, `${label}: 区画の終端が見つからない`).toBeGreaterThan(fnAt);
  return source.slice(from, to);
}

describe('shared（契約の正）とサーバーの写しの突合', () => {
  it('画像 base64 上限が一致する', () => {
    const match = SHARED_AI_CONSTANTS.match(/MAX_INFER_IMAGE_BASE64_LENGTH = ([\d_]+);/);
    expect(match).not.toBeNull();
    expect(Number((match as RegExpMatchArray)[1].replace(/_/g, ''))).toBe(MAX_IMAGE_BASE64_LENGTH);
  });

  /**
   * 語彙表・盛り付け行の**データ**だけを突き合わせても、`inferCuisine` の**ロジック**
   * （段の打ち切り・同点の裁き方）が写しでズレたときに割れない。写しは
   * 「import 行から下が shared と 1 文字も違わない」ことで作られているので、
   * そこを丸ごと比べる — 下の粒度の細かいテストは、割れたときにどの表かを言うために残す。
   */
  it('cuisine の写しが import 行から下まで shared と完全一致する', () => {
    const shared = SHARED_CUISINE.split("import { vocabKey } from './ai';");
    const server = SERVER_CUISINE_SOURCE.split(
      "import { nameKey as vocabKey } from './fridge-vision.js';",
    );
    expect(shared.length, 'shared の import 行が変わった').toBe(2);
    expect(server.length, '写しの import 行が変わった').toBe(2);
    expect(server[1]).toBe(shared[1]);
  });

  /**
   * 語彙表を突き合わせても、**照合キーの作り方**が写しでズレたら意味が無い
   * （半角カナ変換を片方だけ落とすと `ﾊﾟｽﾀ` が当たらなくなるが、表は一致したまま緑）。
   * shared の `vocabKey` と server の `nameKey` は同じ変換であることが前提なので、
   * 関数の本体（`return` から `}` まで）を突き合わせる。
   */
  it('照合キー（shared vocabKey / server nameKey）の本体が一致する', () => {
    const bodyOf = (source: string, name: string): string => {
      const head = `export function ${name}(name: string): string {`;
      const from = source.indexOf(head);
      expect(from, `${name} が見つからない`).toBeGreaterThanOrEqual(0);
      const to = source.indexOf('\n}', from);
      expect(to, `${name} の終端が見つからない`).toBeGreaterThan(from);
      return source.slice(from + head.length, to);
    };
    expect(bodyOf(SERVER_FRIDGE_VISION_SOURCE, 'nameKey')).toBe(
      bodyOf(SHARED_AI_CONSTANTS, 'vocabKey'),
    );
  });

  it('出自（cuisine）の一覧が一致する', () => {
    const match = SHARED_CUISINE.match(/export const CUISINES = \[([\s\S]*?)\] as const;/);
    expect(match).not.toBeNull();
    const shared = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(shared.length).toBeGreaterThan(0);
    expect([...SERVER_CUISINES]).toEqual(shared);
  });

  it.each([
    ['CUISINE_TAG_WORDS', SERVER_CUISINE_TAG_WORDS],
    ['CUISINE_TITLE_WORDS', SERVER_CUISINE_TITLE_WORDS],
    ['CUISINE_INGREDIENT_WORDS', SERVER_CUISINE_INGREDIENT_WORDS],
  ] as const)('%s の語彙が一致する', (name, serverTable) => {
    const shared = sharedWordTable(name);
    expect(Object.keys(shared).sort()).toEqual(Object.keys(serverTable).sort());
    for (const cuisine of Object.keys(serverTable) as Cuisine[]) {
      expect(shared[cuisine], `${name}.${cuisine}`).toBeDefined();
      expect(shared[cuisine].length).toBeGreaterThan(0);
      expect([...serverTable[cuisine]]).toEqual(shared[cuisine]);
    }
  });

  it('盛り付けの 1 行が出自 × locale の全組で一致する', () => {
    // 盛り付け行は写しがズレても型が割れない（ただの文字列）ので、
    // shared のソースをそのまま検索して同じ文が載っていることを確かめる。
    for (const cuisine of SERVER_CUISINES) {
      for (const locale of ['ja', 'en'] as const) {
        const line = serverPlatingLineFor(cuisine, locale);
        expect(line.length).toBeGreaterThan(0);
        expect(SHARED_CUISINE, `${cuisine}/${locale} の行が shared に無い`).toContain(line);
      }
    }
  });

  it('手順のイラストのプロンプトが shared と完全一致する', () => {
    expect(stepImagePromptRegion(SERVER_STEP_IMAGE, '写し')).toBe(
      stepImagePromptRegion(SHARED_STEP_IMAGE, 'shared'),
    );
  });
  it('カテゴリ語リストが一致する', () => {
    const block = SHARED_AI_CONSTANTS.match(
      /export const CATEGORY_NAME_WORDS = \[([\s\S]*?)\] as const;/,
    );
    expect(block).not.toBeNull();
    const sharedWords = [...(block as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(sharedWords.length).toBeGreaterThan(0);
    expect([...SERVER_CATEGORY_NAME_WORDS]).toEqual(sharedWords);
  });
});
