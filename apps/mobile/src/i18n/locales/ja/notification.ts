/**
 * 通知（タイマー・在庫の残量）と広告まわり。
 *
 * 通知チャンネル名は **OS の設定画面にそのまま出る**。端末の言語で
 * 表示されるので、辞書から引く。
 */
import type { PluralMessage } from '../../types';

const notification = {
  timerChannel: '調理タイマー',
  timerDoneTitle: 'タイマー終了',
  timerDoneBody: '調理時間が終わりました。',

  cookingChannel: '調理中の表示',
  cookingBody: '手順 {{step}} / {{total}} ・ タップで続きへ',
  lowStockChannel: '在庫の残量通知',
  lowStockTitle: '在庫がなくなりそうです',
  lowStockBody: '{{names}} の残りが少なくなっています。買い物リストに追加しましょう。',
  lowStockMore: {
    one: ' ほか{{count}}件',
    other: ' ほか{{count}}件',
  } satisfies PluralMessage,
};

export default notification;
