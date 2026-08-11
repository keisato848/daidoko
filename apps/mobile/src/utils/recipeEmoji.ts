/**
 * レシピ名から表紙用の絵文字を選ぶ。表紙写真が無いときの見た目の埋め草。
 *
 * **翻訳の対象ではない。** 料理名そのものを引く辞書なので、言語ごとに作る
 * （設計 §7・P5）。一致しなければ汎用の皿を返すだけなので、未対応の言語でも壊れない。
 *
 * 日本語は料理名そのままの完全一致、英語は語のゆらぎが大きいので語句の部分一致。
 * **英語は上から順に見て最初に当たったものを使う**ので、限定的な語句ほど先に置く
 * （"Hamburg Steak" が steak ではなく hamburg に当たるように）。
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
  ふわとろスクランブルエッグトースト: '🍳',
};

const KEYWORD_EMOJI: readonly (readonly [string, string])[] = [
  ['scrambled egg', '🍳'],
  ['pork miso soup', '🫕'],
  ['miso soup', '🍜'],
  ['fried chicken', '🍗'],
  ['hamburg', '🍔'],
  ['burger', '🍔'],
  ['curry', '🍛'],
  ['ramen', '🍜'],
  ['noodle', '🍜'],
  ['pasta', '🍝'],
  ['salad', '🥗'],
  ['stew', '🍲'],
  ['soup', '🍲'],
  ['toast', '🍞'],
  ['bread', '🍞'],
  ['cake', '🍰'],
  ['chicken', '🍗'],
  ['steak', '🥩'],
  ['beef', '🥩'],
  ['pork', '🥓'],
  ['fish', '🐟'],
  ['rice', '🍚'],
  ['egg', '🥚'],
];

const FALLBACK_EMOJI = '🍽️';

export function getRecipeEmoji(title: string): string {
  const exact = TITLE_EMOJI[title];
  if (exact !== undefined) return exact;

  const lowered = title.toLowerCase();
  for (const [keyword, emoji] of KEYWORD_EMOJI) {
    if (lowered.includes(keyword)) return emoji;
  }
  return FALLBACK_EMOJI;
}
