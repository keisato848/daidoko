/**
 * レシピまわりの文言（詳細・作成・取り込み・お店の味を再現）。
 */
import type { CriticalMessage } from '../../types';

const recipe = {
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

    /**
     * 感想から変更点を読み取れなかったとき。**失敗ではなく入力不足**なので、
     * 再試行を促すのではなく「何を書けばよいか」を伝える（R2 の設計判断）。
     */
    noChange: {
      text: '感想から、何をどう変えればよいか読み取れませんでした。「甘すぎた」「もっと辛く」のように、味の方向を書いてみてください。',
      intent:
        'MUST tell the user WHAT TO WRITE next (a taste direction), with examples. ' +
        'MUST NOT be a bare "try again" — retrying the same text cannot succeed. ' +
        'This is an input-insufficiency message, not an error.',
    } satisfies CriticalMessage,

    failed: 'レシピを調整できませんでした',
    convertFailed: '調整結果をレシピに変換できませんでした',
    done: 'レシピを調整しました。',
  },
};

export default recipe;
