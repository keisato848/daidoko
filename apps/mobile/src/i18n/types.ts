/**
 * 辞書の型。設計は `docs/多言語対応設計.md` §6。
 *
 * **A 階層（意味が崩れると機能が壊れる文言）だけが `intent` を持つ。**
 * 型で強制することで、A 階層に intent を書き忘れると**コンパイルで落ちる**。
 */

/**
 * A 階層の文言。日本語文だけでは、翻訳する人（将来の自分を含む）が
 * **何を守るべきか分からない**。何を伝え、何と混同させてはいけないかを併記する。
 */
export interface CriticalMessage {
  text: string;
  /**
   * 翻訳者への指示。**英語で書く**（翻訳する人が読むもので、翻訳対象ではない）。
   * 「MUST convey: …」「MUST NOT be confusable with: …」の形で書く。
   */
  intent: string;
}

/**
 * 数に応じて形が変わる文言。
 *
 * 日本語は単複の区別がないので `other` だけで足りるが、**英語は足りない**
 * （「1 recipe」「2 recipes」）。日本語側も同じ形にしておかないと、
 * 英語を書く人が「ここは数が入る」と気づけない。
 *
 * 使うときは `t()` ではなく `tCount()`。型で取り違えを防ぐ。
 */
export interface PluralMessage {
  one: string;
  other: string;
}

/**
 * 数が変わり、かつ意味が崩れると機能が壊れる文言（削除件数の確認など）。
 * `one`/`other` それぞれに intent を持たせる — 片方だけ弱まっても事故になる。
 */
export interface CriticalPluralMessage {
  one: CriticalMessage;
  other: CriticalMessage;
}

/** A 階層かどうかの判定（parity テストで使う）。 */
export function isCriticalMessage(value: unknown): value is CriticalMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CriticalMessage).text === 'string' &&
    typeof (value as CriticalMessage).intent === 'string'
  );
}
