/**
 * A 階層の文言が満たすべき条件（`semantics.test.ts` が使う）。
 *
 * **辞書と別ファイルに置くことに意味がある。**
 * 同じファイルに置くと、翻訳を直すときに期待値も一緒に直してしまい、
 * 「テストは通るが意味は壊れている」状態になる。ここを直すときは
 * 「**仕様が変わったのか、訳をごまかそうとしているのか**」を必ず自問すること。
 */

/** その言語で「その意味を伝えているなら必ず現れる」語。 */
export const EXPECTED_KEYWORDS = {
  ja: {
    /** 再接続を促している */
    reconnect: /(つながって|接続|オフライン|ネットワーク)/,
    /** 待つことを伝えている */
    wait: /(時間をおいて|しばらく|明日|あとで)/,
    /** 利用上限に言及している */
    limit: /(上限|制限|使い切)/,
    /** 変わっていないことの断定 */
    unchanged: /変わっていません/,
  },
  en: {
    reconnect: /\b(offline|reconnect|connection|internet|network)\b/i,
    wait: /\b(wait|later|tomorrow|try again)\b/i,
    limit: /\b(limit|quota|reached)\b/i,
    unchanged: /\b(unchanged|not changed)\b/i,
  },
} as const;

/** 現れてはいけない表現。**保証を弱める言い回し**を禁じる。 */
export const FORBIDDEN_PATTERNS = {
  ja: {
    // 「変わっていないはずです」「変わっていない場合があります」等への後退を禁じる
    hedging: [/はずです/, /場合があります/, /かもしれません/, /可能性があります/, /と思われます/],
  },
  en: {
    // "may not have changed" / "should be unchanged" 等への後退を禁じる
    hedging: [/\bmay\b/i, /\bmight\b/i, /\bshould be\b/i, /\bprobably\b/i, /\blikely\b/i],
  },
} as const;
