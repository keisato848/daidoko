/**
 * AI の**出力言語**。サーバー側 `apps/server/src/lib/output-locale.ts` の写し。
 *
 * サーバーは実行時に `@daidoko/shared` を取り込まない方針（tsconfig の rootDir が
 * `src` に閉じており、既存のコードも型を各アプリで写している）。そのため
 * 共有せず、両側に同じ規則を置いている。**片方だけ直さないこと。**
 *
 * プロンプト本体は日本語のまま残す。モデルへの指示であって画面には出ないし、
 * v1 の内容は日本語で品質を測ってある（`docs/レシピ推論の評価設計.md`）。
 * 全文を訳すとその測定が無効になる。差し替えるのは**出力言語と入手性の前提だけ**。
 */
import { getLocale, type Locale } from '../i18n';

export type OutputLocale = Locale;

/** サーバーへ送るロケール。端末の言語をそのまま送る。 */
export function requestLocale(): OutputLocale {
  return getLocale();
}

/**
 * プロンプト末尾に付ける出力言語の指示。
 *
 * 日本語のプロンプトに英語の出力を指示しても Gemini は従う。指示は
 * **最後に置く**（直近の指示ほど効きやすい）。
 */
export function outputLanguageInstruction(locale: OutputLocale): string {
  if (locale === 'en') {
    return [
      '',
      '## Output language (overrides any earlier instruction about Japanese)',
      'Write every field of the response in natural English: dish name, ingredient names,',
      'amounts, steps and notes. Do not output Japanese.',
      'Use units and ingredients a cook in an English-speaking country can buy locally',
      '(cups/tablespoons/ounces alongside grams, supermarket staples). When a dish needs an',
      'ingredient that is hard to find outside Japan, substitute something widely available',
      'and name the original in the note.',
    ].join('\n');
  }
  return ['', 'すべて自然な日本語で出力する。'].join('\n');
}

/** システムプロンプトに出力言語の指示を足す。 */
export function withOutputLanguage(prompt: string, locale: OutputLocale = getLocale()): string {
  return `${prompt}\n${outputLanguageInstruction(locale)}`;
}
