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
