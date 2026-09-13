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
import { MAX_IMAGE_BASE64_LENGTH } from '../routes/infer.js';

/**
 * ソースを読むときは**改行コードを潰す**。このリポジトリには `.gitattributes` が無く、
 * Windows では `core.autocrlf=true` で CRLF、CI（Linux）では LF で checkout される。
 * 生のまま比べると「片方だけ CRLF」で割れて、写しの中身は同じなのに赤くなる。
 */
function readSource(...segments: string[]): string {
  return readFileSync(resolve(__dirname, ...segments), 'utf8').replace(/\r\n/g, '\n');
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

const SHARED_AI_CONSTANTS = readFileSync(
  resolve(__dirname, '../../../../packages/shared/src/constants/ai.ts'),
  'utf8',
);

describe('shared（契約の正）とサーバーの写しの突合', () => {
  it('画像 base64 上限が一致する', () => {
    const match = SHARED_AI_CONSTANTS.match(/MAX_INFER_IMAGE_BASE64_LENGTH = ([\d_]+);/);
    expect(match).not.toBeNull();
    expect(Number((match as RegExpMatchArray)[1].replace(/_/g, ''))).toBe(MAX_IMAGE_BASE64_LENGTH);
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
