/**
 * 手順のイラストのプロンプト `buildStepImagePrompt`（`constants/step-image.ts`・契約の正）。
 * docs/レシピ表紙AI生成設計.md §8-3。
 *
 * 期待する文面は**このファイル内のリテラル**で固定する（実装の定数を import して比べると、
 * 実装が壊れても一緒に壊れて緑のまま — docs/品質基準.md §2.3）。
 *
 * 一番守りたいのは「完成皿を描かない」。これが落ちると手順 2 の絵に完成品が出て、
 * どの手順の絵も同じに見える（§8-3 の縛りを足した理由そのもの）。
 */
import { describe, expect, it } from 'vitest';

import { buildStepImagePrompt } from '../constants/step-image';

const BASE = {
  title: '麻婆豆腐',
  ingredientNames: ['木綿豆腐', '豚ひき肉', '甜麺醤'],
  stepBody: '豆腐をさいの目に切り、湯通しする',
  stepIndex: 3,
  stepCount: 5,
};

describe('buildStepImagePrompt — 縛り 5 項目（1 行ずつ独立に）', () => {
  const text = buildStepImagePrompt(BASE);

  it('① 手描きの絵のようなイラストにする・写真の質感を描かない', () => {
    expect(text).toContain(
      '手描きの絵のようなイラストにする。写真のような質感・実物らしさを描かない。',
    );
  });

  it('② 文字・ロゴ・透かし・人物・手を描かない', () => {
    expect(text).toContain('文字・ロゴ・透かし・人物・手を描かない。');
  });

  it('③ 材料リストに無い食材を描き足さない', () => {
    expect(text).toContain('材料リストに無い食材を描き足さない。');
  });

  it('④ 完成した料理の盛り付け（できあがりの一皿）を描かない — 落ちると手順の絵が全部完成品になる', () => {
    expect(text).toContain('完成した料理の盛り付け（できあがりの一皿）を描かない。');
    expect(text).toContain('この手順の途中の状態だけを描く。');
  });

  it('⑤ 実在する店舗名・ブランド名を描かない', () => {
    expect(text).toContain('実在する店舗名・ブランド名を描かない。');
  });

  it('依頼の本文: この手順でしていることが分かるイラストを 1 枚', () => {
    expect(text).toContain('この手順でしていることが分かるイラストを 1 枚描いてください。');
  });
});

describe('buildStepImagePrompt — 表紙のプロンプトと混ざっていない', () => {
  it('「写真のように」を含まない（表紙は写真の質感を要求し、手順はそれを禁止する）', () => {
    const text = buildStepImagePrompt(BASE);
    expect(text).not.toContain('写真のように');
    expect(text).not.toContain('できあがりを写真のように');
  });

  it('表紙の末尾行（食卓の盛り付け指示）を含まない', () => {
    expect(buildStepImagePrompt(BASE)).not.toContain('自然な盛り付けにする');
    expect(buildStepImagePrompt({ ...BASE, locale: 'en' })).not.toContain('Plate and style it');
  });

  it('タグ行を出さない（手順のプロンプトはタグを使わない）', () => {
    expect(buildStepImagePrompt(BASE)).not.toContain('タグ:');
  });
});

describe('buildStepImagePrompt — 手順の位置と本文', () => {
  it('「手順 3 / 5: <本文>」の行が 1 行で出る', () => {
    const text = buildStepImagePrompt(BASE);
    expect(text.split('\n')).toContain('手順 3 / 5: 豆腐をさいの目に切り、湯通しする');
  });

  it('stepIndex を変えると行が変わる（1 / 5）', () => {
    const text = buildStepImagePrompt({ ...BASE, stepIndex: 1 });
    expect(text.split('\n')).toContain('手順 1 / 5: 豆腐をさいの目に切り、湯通しする');
    expect(text).not.toContain('手順 3 / 5');
  });

  it('stepCount を変えると行が変わる（3 / 12）', () => {
    const text = buildStepImagePrompt({ ...BASE, stepCount: 12 });
    expect(text.split('\n')).toContain('手順 3 / 12: 豆腐をさいの目に切り、湯通しする');
    expect(text).not.toContain('手順 3 / 5');
  });

  it('料理名の行が先頭に出る', () => {
    expect(buildStepImagePrompt(BASE).split('\n')[0]).toBe('料理名: 麻婆豆腐');
  });
});

describe('buildStepImagePrompt — 材料', () => {
  it('材料があれば「使われている材料:」の行に「、」区切りで並ぶ', () => {
    const lines = buildStepImagePrompt(BASE).split('\n');
    expect(lines).toContain('使われている材料: 木綿豆腐、豚ひき肉、甜麺醤');
  });

  it('材料が空なら材料行が出ない', () => {
    const text = buildStepImagePrompt({ ...BASE, ingredientNames: [] });
    expect(text).not.toContain('使われている材料');
    // 料理名と手順行は残る
    expect(text).toContain('料理名: 麻婆豆腐');
    expect(text).toContain('手順 3 / 5: ');
  });
});

describe('buildStepImagePrompt — locale', () => {
  const JA_TAIL = '日本の家庭の台所で、この手順をしているところが分かる素朴な絵にする。';
  const EN_TAIL =
    'Draw it as a simple hand-drawn cooking illustration, as it would look in an English-language recipe booklet.';

  it('省略時は ja の末尾行', () => {
    const lines = buildStepImagePrompt(BASE).split('\n');
    expect(lines[lines.length - 1]).toBe(JA_TAIL);
    expect(lines).not.toContain(EN_TAIL);
  });

  it('locale: ja は ja の末尾行', () => {
    const lines = buildStepImagePrompt({ ...BASE, locale: 'ja' }).split('\n');
    expect(lines[lines.length - 1]).toBe(JA_TAIL);
  });

  it('locale: en は en の末尾行に変わり、ja の行は消える', () => {
    const lines = buildStepImagePrompt({ ...BASE, locale: 'en' }).split('\n');
    expect(lines[lines.length - 1]).toBe(EN_TAIL);
    expect(lines).not.toContain(JA_TAIL);
  });

  it('locale: en でも縛り（完成皿を描かない）は残る', () => {
    expect(buildStepImagePrompt({ ...BASE, locale: 'en' })).toContain(
      '完成した料理の盛り付け（できあがりの一皿）を描かない。',
    );
  });
});
