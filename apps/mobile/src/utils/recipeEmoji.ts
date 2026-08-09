/**
 * レシピ名から表紙用の絵文字を選ぶ。表紙写真が無いときの見た目の埋め草。
 *
 * **翻訳の対象ではない。** 日本語の料理名そのものを引く辞書なので、
 * 対象言語ごとに作り直しになる（設計 §7・P5）。
 * 一致しなければ汎用の皿を返すだけなので、他言語でも壊れない。
 *
 * レシピ一覧と詳細で同じ実装が重複していたのをここへ寄せた。
 */
const TITLE_EMOJI: Record<string, string> = {
  肉じゃが: '🍲',
  味噌汁: '🍜',
  唐揚げ: '🍗',
  炊き込みご飯: '🍚',
  豚汁: '🫕',
  ハンバーグ: '🍔',
};

const FALLBACK_EMOJI = '🍽️';

export function getRecipeEmoji(title: string): string {
  return TITLE_EMOJI[title] ?? FALLBACK_EMOJI;
}
