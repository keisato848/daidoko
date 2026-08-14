/**
 * ペイウォール（プレミアム・広告リワード）。
 *
 * 課金の条件はストアの規約でも表示が求められる箇所なので、
 * 自動更新の説明と広告リワードの有効期限は A 階層。
 */
import type { CriticalMessage, PluralMessage } from '../../types';

const paywall = {
  title: 'DAIDOKO プレミアム',
  subtitle: {
    one: '無料のAIレシピ作成は初回{{count}}回まで。以降は広告を見るたびに1回使えます。\nプレミアムなら、回数を気にせず使えます。',
    other:
      '無料のAIレシピ作成は初回{{count}}回まで。以降は広告を見るたびに1回使えます。\nプレミアムなら、回数を気にせず使えます。',
  } satisfies PluralMessage,

  benefit: {
    unlimited: '写真からのレシピづくりが使い放題',
    noWorry: '回数の上限を気にせず、思いついたときにすぐ',
    future: 'これからふえる便利な機能もぜんぶ',
  },

  priceFallback: '月額サブスク',
  priceUnit: '/ 月（いつでも解約可能）',
  priceUnitFallback: 'いつでも解約可能',
  subscribe: 'プレミアムを始める',
  restore: '購入を復元する',

  /** 自動更新の条件。**ストアの規約でも表示が要る**ので削れない。 */
  terms: {
    text: 'サブスクリプションは購入時に課金され、解約しない限り自動更新されます。解約はストアのアカウント設定からいつでも行えます。',
    intent:
      'MUST state that the subscription auto-renews unless cancelled, that it is charged at ' +
      'purchase, and where to cancel. App store rules require all three; dropping any of them ' +
      'is both a policy violation and a misrepresentation of a recurring charge.',
  } satisfies CriticalMessage,

  /** 審査ガイドライン 3.1.2 が求めるリンクのラベル。リンク自体を消さないこと。 */
  eula: '利用規約',
  privacyPolicy: 'プライバシーポリシー',

  or: 'または',
  watchAd: '広告を見て 1 回ぶん貯める',
  /** 貯めた回数が**失効しない**ことの説明。当日限りだと誤解させない。 */
  tokenHint: {
    text: '貯めた回数はなくなりません。いつでも使えます。',
    intent:
      'MUST convey that earned credits DO NOT EXPIRE. They were day-scoped bonuses before and ' +
      'are now permanent tokens; implying they expire would make the reward look worthless.',
  } satisfies CriticalMessage,
  tokenBalance: {
    one: 'ためた回数: 残り{{count}}回ぶん',
    other: 'ためた回数: 残り{{count}}回ぶん',
  } satisfies PluralMessage,

  thanksTitle: 'ありがとうございます',
  adGranted: {
    one: '写真からのレシピづくりが 1 回ぶん貯まりました（残り {{count}} 回ぶん）。\nいつでも使えます。',
    other:
      '写真からのレシピづくりが 1 回ぶん貯まりました（残り {{count}} 回ぶん）。\nいつでも使えます。',
  } satisfies PluralMessage,
  subscribed: 'プレミアムになりました。写真からのレシピづくりを使い放題でお楽しみください。',

  noticeTitle: 'お知らせ',
  adFailed: '広告を読み込めませんでした。時間をおいてお試しください。',
  purchaseFailed: '購入を完了できませんでした。時間をおいてお試しください。',
  restoredTitle: '復元しました',
  restoredBody: 'プレミアムが有効になりました。',
  nothingToRestore: '復元できる購入が見つかりませんでした。',
  restoreFailed: '購入の復元に失敗しました。時間をおいてお試しください。',
};

export default paywall;
