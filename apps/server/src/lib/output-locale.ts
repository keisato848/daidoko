/**
 * AI の**出力言語**を決める。
 *
 * プロンプト本体は日本語のまま残す。これはモデルへの指示であって画面には
 * 出ないし、v1 の内容は日本語で品質を測ってある（`docs/レシピ推論の評価設計.md`）。
 * 全文を訳すと、その測定が丸ごと無効になる。
 *
 * 代わりに、**出力言語と入手性の前提だけ**をロケールごとに差し替える。
 * ここが抜けると、英語の利用者が写真を撮っても日本語のレシピが返る
 * — 画面だけ英語で中身が日本語という、いちばん困る状態になる。
 */
export type OutputLocale = 'ja' | 'en';

export const DEFAULT_OUTPUT_LOCALE: OutputLocale = 'ja';

export function parseOutputLocale(value: unknown): OutputLocale {
  return value === 'en' ? 'en' : DEFAULT_OUTPUT_LOCALE;
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
export function withOutputLanguage(prompt: string, locale: OutputLocale): string {
  return `${prompt}\n${outputLanguageInstruction(locale)}`;
}

// ─── 単位系（P1・docs/多言語対応設計.md §4） ─────────────────────────────────

/**
 * **単位は翻訳ではなく「正しさ」の問題。** AI は「180度」「大さじ1」を出すが、
 * 米国の利用者に 180°F と読まれれば料理が失敗する。
 *
 * 言語とは別に持つ（英国の利用者は英語だがメートル法）。アプリ側で数値を
 * 変換するのではなく、**モデルに最初からその単位で書かせる** — 変換すると
 * 丸めが重なるうえ、材料の呼び方（"1 stick of butter"）まではついてこない。
 */
export type OutputUnitSystem = 'metric' | 'imperial';

export const DEFAULT_UNIT_SYSTEM: OutputUnitSystem = 'metric';

export function parseUnitSystem(value: unknown): OutputUnitSystem {
  return value === 'imperial' ? 'imperial' : DEFAULT_UNIT_SYSTEM;
}

/**
 * プロンプト末尾に付ける単位系の指示。**出力言語の指示より後ろに置く**
 * （言語側にも単位の言及があるので、こちらを後に置いて勝たせる）。
 *
 * **メートル法では何も足さない。** プロンプト本体がすでにメートル法を前提に
 * 書かれていて、その内容で品質を測ってある（`docs/レシピ推論の評価設計.md`）。
 * 既定の利用者に届くプロンプトを変えずに済ませる方が、測定も挙動も守れる。
 */
export function unitSystemInstruction(system: OutputUnitSystem): string {
  if (system !== 'imperial') return '';
  return [
    '',
    '## Units (overrides any earlier instruction about units)',
    'Write amounts in US customary units: cups, tablespoons, teaspoons, ounces, pounds,',
    'and fluid ounces. Write oven and oil temperatures in Fahrenheit (°F).',
    'Round to values a cook can actually measure. Do not also list metric values.',
  ].join('\n');
}

/** システムプロンプトに単位系の指示を足す。メートル法なら素通し。 */
export function withUnitSystem(prompt: string, system: OutputUnitSystem): string {
  const instruction = unitSystemInstruction(system);
  return instruction ? `${prompt}\n${instruction}` : prompt;
}
