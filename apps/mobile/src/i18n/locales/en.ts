/**
 * 英語辞書。**`typeof ja` に縛られる**ので、キーの抜けはコンパイルで落ちる（§3-2）。
 *
 * ただし型は**中身の正しさを見ない**。空文字でも意味の違う文でも型は通るため、
 * A 階層は `__tests__/semantics.test.ts` で意味の同一性を検査する（§6-5）。
 *
 * 各文言の `intent`（ja 側に記載）を読んでから書くこと。
 */
import type ja from './ja';

const en: typeof ja = {
  error: {
    offline: {
      text: "You're offline. Reconnect and try again.",
      intent:
        'MUST convey: the user should reconnect, and doing so fixes it. ' +
        'MUST NOT be confusable with quota exhaustion (which waiting, not reconnecting, resolves).',
    },
    quotaExceeded: {
      text: "You've reached today's AI limit. Please try again tomorrow.",
      intent:
        'MUST convey: the daily limit is reached and the user must wait; retrying now will not help. ' +
        'MUST NOT be confusable with a network failure or a temporary server error.',
    },
    transient: {
      text: 'The AI service is busy. Please wait a moment and try again.',
      intent:
        'MUST convey: temporary congestion; retrying shortly is likely to succeed. ' +
        'MUST NOT be confusable with the daily quota being exhausted.',
    },
  },

  recipe: {
    refine: {
      diffGuarantee: {
        text: 'Anything not listed here is unchanged. Please review before saving.',
        intent:
          'MUST convey an absolute guarantee: anything NOT shown in the diff is unchanged. ' +
          'MUST NOT be softened to a probability ("may not have changed", "should be unchanged") — ' +
          'this sentence is the reason the diff preview exists as a safety check.',
      },
    },
  },
};

export default en;
