/**
 * 日本語辞書。**これが原本**で、`en.ts` は `typeof ja` に縛られる（§3-2）。
 *
 * 試作段階のため、A 階層（§6-6 の 30 件）のうち
 * **最も守りたい 4 件**だけを入れている。仕組みが効くと確かめてから全件を移す。
 */
import type { CriticalMessage } from '../types';

const ja = {
  error: {
    /**
     * #120 で作った区別。**取るべき行動が違う**ので、混同させてはいけない。
     * オフライン = 再接続で直る / 枠切れ = 待つしかない。
     */
    offline: {
      text: 'インターネットにつながっていません。接続してからもう一度お試しください。',
      intent:
        'MUST convey: the user should reconnect, and doing so fixes it. ' +
        'MUST NOT be confusable with quota exhaustion (which waiting, not reconnecting, resolves).',
    } satisfies CriticalMessage,

    quotaExceeded: {
      text: '本日の AI 利用上限に達しました。時間をおいてお試しください。',
      intent:
        'MUST convey: the daily limit is reached and the user must wait; retrying now will not help. ' +
        'MUST NOT be confusable with a network failure or a temporary server error.',
    } satisfies CriticalMessage,

    transient: {
      text: 'AI が混み合っています。少し時間をおいてもう一度お試しください。',
      intent:
        'MUST convey: temporary congestion; retrying shortly is likely to succeed. ' +
        'MUST NOT be confusable with the daily quota being exhausted.',
    } satisfies CriticalMessage,
  },

  recipe: {
    refine: {
      /**
       * R2 の差分プレビューの保証文。**AI が黙って書き換えないことの保証**であり、
       * 弱まると説明が嘘になる（§6-2）。
       */
      diffGuarantee: {
        text: 'ここに出ていない材料・手順は変わっていません。内容を確認してから保存してください。',
        intent:
          'MUST convey an absolute guarantee: anything NOT shown in the diff is unchanged. ' +
          'MUST NOT be softened to a probability ("may not have changed", "should be unchanged") — ' +
          'this sentence is the reason the diff preview exists as a safety check.',
      } satisfies CriticalMessage,
    },
  },
} as const;

export default ja;
