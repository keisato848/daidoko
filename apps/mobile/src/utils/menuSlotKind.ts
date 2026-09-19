/**
 * レシピを枠の種類（副菜・汁物・サラダ・デザート）へ分類する（Track C PR-5a）。
 *
 * **レシピに種別の列は無い**（`schema.ts` の recipes は自由入力の `tags` だけ）。
 * だから AI 抜きで副菜・汁物を埋めるには、題名とタグの語彙で当てるしかない。
 * 当たらないものは `null` = 主菜候補として扱う。**外れることの方が多い**前提で、
 * 埋められない枠は空のまま出す（偽の副菜を置くより、「まだ決めていません」の方が正直）。
 *
 * 前例: サーバー `lib/cuisine.ts` の「タグ完全一致＋題名部分一致」。
 * 語彙を増やすときは**テストに 1 行足してから**（当たり外れがここで固定される）。
 */
import type { SlotKind } from './menuSlots';

/** タグは完全一致（正規化後）。ja / en の両方を持つ */
const TAG_VOCAB: Record<Exclude<SlotKind, 'main'>, readonly string[]> = {
  side: ['副菜', '小鉢', 'side', 'side dish'],
  soup: ['汁物', 'スープ', 'soup'],
  salad: ['サラダ', 'salad'],
  dessert: ['デザート', 'おやつ', 'dessert', 'sweets'],
};

/**
 * 題名は部分一致。**順序に意味がある** — 先に当たった種類で決める。
 * 「サラダ」より「スープ」を先に見るのは、「スープサラダ」のような題名が無いため
 * どちらでもよいが、汁物の語彙の方が誤爆しにくい（「〜汁」は副菜にはならない）。
 */
const TITLE_VOCAB: readonly [Exclude<SlotKind, 'main'>, readonly string[]][] = [
  [
    'soup',
    ['味噌汁', 'みそ汁', '豚汁', 'すまし汁', 'スープ', 'ポタージュ', '汁', 'soup', 'chowder'],
  ],
  ['salad', ['サラダ', 'salad']],
  [
    'dessert',
    [
      'プリン',
      'ゼリー',
      'ケーキ',
      'アイス',
      'クッキー',
      'ムース',
      'pudding',
      'jelly',
      'cake',
      'ice cream',
      'cookie',
    ],
  ],
  [
    'side',
    [
      'おひたし',
      'お浸し',
      '和え',
      'あえ',
      'ナムル',
      'マリネ',
      '浅漬け',
      'きんぴら',
      '冷奴',
      '白和え',
      'ごま和え',
      'pickles',
      'namul',
    ],
  ],
];

/** 全角/半角・大文字小文字・前後の空白の揺れを潰す。長音「ー」は保つ */
function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim();
}

/**
 * 分類。**タグが題名より優先**（利用者が付けたタグは明示の意思）。
 * どれにも当たらなければ `null`（主菜候補）。
 */
export function classifySlotKind(title: string, tags: readonly string[] = []): SlotKind | null {
  const normalizedTags = tags.map(normalize);
  for (const kind of Object.keys(TAG_VOCAB) as (keyof typeof TAG_VOCAB)[]) {
    if (TAG_VOCAB[kind].some((v) => normalizedTags.includes(normalize(v)))) return kind;
  }
  const t = normalize(title);
  for (const [kind, words] of TITLE_VOCAB) {
    if (words.some((w) => t.includes(normalize(w)))) return kind;
  }
  return null;
}
