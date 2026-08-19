/**
 * Gemini を呼ぶライブラリが、すべて思考トークンの設定を通していることの横断チェック。
 *
 * **なぜ要るか。** `thinking-budget.ts` は「既定オフ」を一箇所で決める仕組みだが、
 * **それを呼び忘れたライブラリがあっても誰も気づかない**。実際 `garden-vision.ts` は
 * 4 日間ずっと思考ありのまま動いていて、`GEMINI_THINKING_BUDGET` を設定しても
 * 効かない状態だった（2026-08-18 に さいえん手帳側のコスト試算で発覚 / saien-techo#144）。
 * 思考トークンは課金上「出力」に計上され、実測で 1 推論 ¥0.85 → ¥0.35 の差になる。
 * **黙って倍以上払う**類の漏れなので、機械で見張る。
 *
 * 適用の形は 2 つあり、どちらでもよい:
 *
 * - `...thinkingConfigFragment()` を `generationConfig` に展開する（多数派）
 * - ルートで `resolveThinkingBudget()` を解決し、入力として渡す（`vision-recipe.ts`）。
 *   評価ハーネスが provider を直呼びして「思考あり」基準を保てるようにするため
 *
 * 落ちたときは、まずどちらかを**通す**こと。通さないと決めたなら EXEMPT に理由を書く。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const LIB_DIR = resolve(__dirname, '../lib');

/** 思考設定を通さないライブラリと、その理由。無条件に足さないこと。 */
const EXEMPT: Record<string, string> = {
  'recipe-refine.ts':
    '用途都合で thinkingBudget を 0 にハードコードしている。「言われた点だけ直す」処理で ' +
    '創作性が要らず、maxOutputTokens も絞っているため、環境変数で戻せる必要が無い。',
  'thinking-budget.ts': '仕組みそのもの。呼ぶ側ではない。',
};

const files = readdirSync(LIB_DIR)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
  .map((name) => ({ name, source: readFileSync(join(LIB_DIR, name), 'utf8') }));

/** Gemini へリクエストを組み立てているか */
const callers = files.filter((file) => file.source.includes('generationConfig'));

describe('思考トークン設定の適用漏れ', () => {
  it('走査対象を実際に見つけている（パス解決が壊れたら気づく）', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(callers.length).toBeGreaterThan(3);
  });

  it.each(callers.map((file) => file.name))(
    '%s は思考トークンの設定を通している（または理由つきで除外されている）',
    (name) => {
      if (EXEMPT[name]) return; // 理由は EXEMPT に記録済み
      const file = callers.find((candidate) => candidate.name === name);
      const viaFragment = file?.source.includes('thinkingConfigFragment()') ?? false;
      const viaInput = /thinkingBudget\?:|input\.thinkingBudget/.test(file?.source ?? '');
      expect(viaFragment || viaInput).toBe(true);
    },
  );

  it('EXEMPT に、もう Gemini を呼んでいないファイルや消えたファイルが残っていない', () => {
    for (const name of Object.keys(EXEMPT)) {
      if (name === 'thinking-budget.ts') continue; // 呼び側ではないので callers に居なくてよい
      expect(callers.map((file) => file.name)).toContain(name);
    }
  });

  it('recipe-refine は「0 固定」であって、単なる付け忘れではない', () => {
    // EXEMPT の理由が本当かをここで確かめる。ハードコードが消えたら EXEMPT も見直す。
    const refine = files.find((file) => file.name === 'recipe-refine.ts');
    expect(refine?.source).toMatch(/thinkingConfig:\s*\{\s*thinkingBudget:\s*0\s*\}/);
  });
});
