/**
 * 手順のイラストのプロンプト（`docs/レシピ表紙AI生成設計.md` §8-3）。
 *
 * **ここが正。** サーバーは実行時に `@daidoko/shared` を取り込まない方針
 * （tsconfig の `rootDir` が `src` に閉じている）ため `apps/server/src/lib/step-image.ts` が
 * 同じ内容の写しを持ち、`__tests__/shared-parity.test.ts` が突合する。
 * モバイル（BYOK）はこのファイルを直接 import する。**片方だけ直さないこと。**
 *
 * ## 表紙（イメージ）と何が違うか
 *
 * 表紙は**できあがりの一皿を写真のように**描く。手順のイラストは逆で、
 * **調理の途中の状態を、手描きの絵のように**描く。混ぜると「手順 2 の絵に完成品が出る」
 * （＝どの手順の絵も同じに見える）になるので、縛りを 2 つ足している:
 * **完成皿を描かない**・**写真の質感を描かない**。
 *
 * 画風の指定欄は設けない（§8-3 のユーザー決定）。手描きの絵に固定することで、
 * 実写と見紛う絵が手順に並ぶのを避け、「実際の調理とは異なります」の表示と辻褄を合わせる。
 */

/** プロンプトの材料。**写真は送らない**（料理名・材料名・手順の文だけ・§8-4 の開示文と一致）。 */
export interface StepImagePromptInput {
  title: string;
  /** 材料名だけ（分量は渡さない — 幻覚食材を抑える手がかりとしてのみ使う。表紙と同じ） */
  ingredientNames: string[];
  /** この手順の本文 */
  stepBody: string;
  /** 1 始まり */
  stepIndex: number;
  stepCount: number;
  locale?: 'ja' | 'en';
}

/**
 * 縛り（§8-3）。表紙の `PROMPT_CONSTRAINTS` とは**別物**なので使い回さない
 * （表紙は「写真のような質感」を要求し、こちらは禁止している）。
 */
const STEP_PROMPT_CONSTRAINTS = [
  '手描きの絵のようなイラストにする。写真のような質感・実物らしさを描かない。',
  '文字・ロゴ・透かし・人物・手を描かない。',
  '材料リストに無い食材を描き足さない。',
  '完成した料理の盛り付け（できあがりの一皿）を描かない。この手順の途中の状態だけを描く。',
  '実在する店舗名・ブランド名を描かない。',
].join(' ');

/**
 * 1 つの手順を、モデルに渡す 1 つのプロンプトにまとめる。
 * 1 呼び出し 1 枚（§8-3）。純関数・依存ゼロ。
 */
export function buildStepImagePrompt(input: StepImagePromptInput): string {
  const locale = input.locale ?? 'ja';
  const lines = [`料理名: ${input.title}`];
  if (input.ingredientNames.length > 0) {
    lines.push(`使われている材料: ${input.ingredientNames.join('、')}`);
  }
  // 何番目かを渡すのは、モデルが「途中」をどのくらい進んだ状態と解釈するかの手がかり
  // （3/5 なら半ばまで進んでいる）。全体の手順数とセットでないと意味がないので必ず両方出す。
  lines.push(`手順 ${input.stepIndex} / ${input.stepCount}: ${input.stepBody}`);
  lines.push('');
  lines.push('この手順でしていることが分かるイラストを 1 枚描いてください。');
  lines.push(STEP_PROMPT_CONSTRAINTS);
  lines.push(
    locale === 'en'
      ? 'Draw it as a simple hand-drawn cooking illustration, as it would look in an English-language recipe booklet.'
      : '日本の家庭の台所で、この手順をしているところが分かる素朴な絵にする。',
  );
  return lines.join('\n');
}
