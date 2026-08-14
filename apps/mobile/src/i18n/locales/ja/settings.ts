/**
 * 設定画面。
 */
import type { PluralMessage } from '../../types';

const settings = {
  title: '設定',
  comingSoonStatus: '今後追加予定',
  comingSoonTitle: '準備中',
  comingSoonBody: 'この機能は今後のバージョンで追加予定です。',

  /** プラン行。プレミアム / BYOK / 無料 で表示が変わる。 */
  plan: {
    sectionTitle: 'プラン',
    upgrade: 'プレミアムにする',
    /** 課金が使えないプラットフォームでの行名。プレミアムへ誘わない。 */
    free: '無料プラン',
    loading: '読み込み中…',
    premium: 'プレミアム',
    premiumSubtitle: 'プレミアム・使い放題',
    premiumBody: 'プレミアムをご利用中です。解約はストアの定期購入設定からいつでも行えます。',
    byok: '自分のAIキー',
    byokSubtitle: '自分のキーで使い放題',
    freeRemaining: {
      one: '無料枠・あと {{count}} 回（以降は広告視聴で1回ずつ）',
      other: '無料枠・あと {{count}} 回（以降は広告視聴で1回ずつ）',
    } satisfies PluralMessage,
  },

  byok: {
    label: '自分のAIキーを使う',
    configured: '設定済み（無制限）',
    notConfigured: 'Gemini キーで無制限に',
  },

  adPrivacy: {
    label: '広告のプライバシー設定',
    subtitle: '広告表示に関する同意を変更',
    failedTitle: 'お知らせ',
    failedBody: '設定画面を表示できませんでした。時間をおいてお試しください。',
  },

  /** R3: 店を出た直後の撮影導線（既定オフ）。 */
  display: {
    sectionTitle: '表示',
    unitSystem: '単位',
    // 言語とは別。英国の利用者は英語だがメートル法で、言語から決めると必ず外す
    unitSystemBody:
      'レシピの分量と温度の見せ方を選びます。保存されている値は変わりません（表示だけを直します）。',
    unitMetric: 'メートル法',
    unitImperial: 'ヤード・ポンド法',
    unitMetricSubtitle: 'g・ml・℃ で表示します',
    unitImperialSubtitle: 'oz・カップ・℉ に直して表示します',
  },

  reproduce: {
    sectionTitle: 'お店の味を再現',
    launchCamera: 'アプリを開いたらすぐ撮影',
    launchCameraSubtitle: '店を出た直後に、起動から1アクションで撮れます',
  },

  account: {
    sectionTitle: 'アカウント',
    profile: 'プロフィール編集',
  },

  family: {
    sectionTitle: '家族',
    group: '家族グループ',
    groupSubtitle: {
      one: '{{name}}（{{count}}人）',
      other: '{{name}}（{{count}}人）',
    } satisfies PluralMessage,
    invite: '家族を招待',
  },

  data: {
    sectionTitle: 'データ',
    backup: 'バックアップ・復元',
    backupSubtitle: '端末内にバックアップを作成・復元',
    sync: 'クラウド同期',
    syncSubtitle: '現在は端末内のみ保存されます',
    nameAliases: '名寄せ辞書',
    nameAliasesSubtitle: 'AIが覚えた食材名の対応を確認・修正',
    webShares: 'レシピ帖',
    webSharesSubtitle: '帖の作成・編集と、Web共有の管理',
  },

  app: {
    sectionTitle: 'アプリ',
    replayCoachMarks: '使い方ガイドを再表示',
    replayCoachMarksSubtitle: '各画面の操作案内をもう一度表示します',
    coachMarksResetTitle: '使い方ガイド',
    coachMarksResetBody: '各画面を開くと操作案内が再表示されます。',
    version: 'バージョン',
    licenses: 'ライセンス情報',
    licensesSubtitle: '利用している OSS ライセンスを表示',
  },

  coach: {
    planTitle: 'AI機能とプラン',
    planText:
      'AI機能（写真レシピ・食材の名寄せ・食事写真）は初回1回無料、以降は広告視聴で1回ずつ使えます。「自分のAIキーを使う」にGeminiキーを設定すると無制限になります。',
    backupTitle: 'データを守る',
    backupText:
      'データは端末内に保存されます。「バックアップ・復元」でファイルに書き出し・復元ができます。',
    guideTitle: '使い方ガイド',
    guideText:
      '各画面の「?」でその画面の案内を再生できます。「使い方ガイドを再表示」を押すと全画面の案内をもう一度見られます。',
  },
  webShares: {
    title: 'レシピ帖',
    emptyTitle: 'レシピ帖はまだありません',
    emptyBody:
      'レシピ一覧で長押し→複数選択→「レシピ帖」から作れます。作った帖はここで編集・共有できます。',
    recipeCount: {
      one: '{{count}}品',
      other: '{{count}}品',
    } satisfies PluralMessage,
    shared: '共有中',
    passcodeOn: 'パスコードあり',
    legacyNote: '以前の形式の共有（停止のみ可）',
    send: 'リンクを送る',
    stopTitle: 'Web共有を停止',
    stopConfirm:
      '共有ページを削除します。リンクを知っている人も見られなくなります。よろしいですか？',
    stopAction: '停止する',
    stopFailed: '停止できませんでした。通信環境を確認してもう一度お試しください。',
    deleteTitle: 'レシピ帖を削除',
    deleteConfirm: 'この帖を削除しますか？（レシピ自体は消えません）',
  },
  book: {
    title: 'レシピ帖',
    name: '帖の名前',
    recipes: '収録レシピ',
    addRecipes: 'レシピを追加',
    noRecipes: 'まだレシピがありません。「レシピを追加」から選んでください。',
    excludedTag: '共有時は除外（URL取り込み）',
    accessTitle: '公開の設定',
    passcodeLabel: 'パスコード（4桁）で保護する',
    passcodeInvalid: 'パスコードは数字4桁で入力してください。',
    expiryNone: '無期限',
    expiryDays: '{{days}}日で失効',
    shareNow: 'Webページで共有する',
    applyUpdate: '更新を反映（リンクはそのまま）',
    updated: '共有ページを更新しました。リンクは変わっていません。',
    sharedNote:
      'この帖は共有中です。中身や設定を変えたら「更新を反映」で同じリンクのまま反映されます。',
  },
};

export default settings;
