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

/** A 階層かどうかの判定（parity テストで使う）。 */
export function isCriticalMessage(value: unknown): value is CriticalMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CriticalMessage).text === 'string' &&
    typeof (value as CriticalMessage).intent === 'string'
  );
}
