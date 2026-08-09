/**
 * 部品（components/）とカレンダーの文言。
 * 画面ではなく部品に属するので、画面の名前空間には入れない。
 */
import type { PluralMessage } from '../../types';

const ui = {
  /** 初回利用ガイド（コーチマーク）。 */
  coach: {
    skipLabel: 'ガイドをスキップ',
    skip: 'スキップ',
    closeLabel: 'ガイドを閉じる',
    nextLabel: '次のガイドへ',
    start: 'はじめる',
    next: '次へ',
  },

  /** 写真の選択（表紙・手順で共通）。 */
  photo: {
    captureLabel: '写真を撮影',
    retake: '撮り直す',
    capture: '撮影',
    gallery: 'ギャラリー',
  },

  /** 料理中モードのタイマー。 */
  timer: {
    start: '開始',
    pause: '一時停止',
    resume: '再開',
    reset: 'リセット',
    finished: '完了！',
  },

  /** 手順の入力行。 */
  step: {
    placeholder: '手順を入力...',
    timerLabel: '⏱ タイマー',
    minutesSuffix: '分',
    suggestLabel: '{{label}}のタイマーを設定',
    suggestSuffix: 'を設定',
  },

  /** 材料の入力行。 */
  ingredient: {
    groupPlaceholder: 'グループ（例: A 調味料）',
    namePlaceholder: '材料名',
    amountPlaceholder: '分量',
  },

  tag: {
    section: 'タグ',
    addPlaceholder: '新しいタグを追加',
  },

  confirm: {
    title: '確認',
  },

  help: {
    label: 'この画面の使い方を表示',
    /** 開閉のラベル。**開いているかどうかで語が変わる**ので分ける。 */
    detailOpen: '{{label}}の詳細を表示',
    detailClose: '{{label}}の詳細を閉じる',
  },

  /**
   * 月の統計（ホーム）。数と単位は別の Text で描くので、
   * **単位だけ**を数に応じて変える（英語は time/times が変わる）。
   */
  stats: {
    cookUnit: {
      one: '回',
      other: '回',
    } satisfies PluralMessage,
    dishUnit: {
      one: '品',
      other: '品',
    } satisfies PluralMessage,
  },

  /** ボトムタブ。 */
  tab: {
    home: 'ホーム',
    recipes: 'レシピ',
    add: '追加',
    settings: '設定',
  },

  gallery: {
    title: 'ギャラリー',
    loading: '写真を読み込んでいます',
    emptyTitle: 'まだ写真がありません',
    emptyMessage: '調理を記録するときに写真を添えると、ここに料理の記録が並びます。',
  },

  licenses: {
    title: 'ライセンス情報',
    heading: 'オープンソースライセンス',
    body: 'だいどこは以下の OSS パッケージを利用しています。各パッケージの著作権表示と完全なライセンス本文は配布元のパッケージに従います。',
  },

  /**
   * 共有テキストの見出し。**取り込みパーサと往復できる書式**なので、
   * 日本語側は変えないこと（`recipeTextParser` が日本語の見出しを見る）。
   * 英語で往復させるには英語版パーサが要る（設計 §7・P5）。
   */
  share: {
    servings: { one: '{{count}}人分', other: '{{count}}人分' } satisfies PluralMessage,
    cookTime: {
      one: '調理時間 {{count}}分',
      other: '調理時間 {{count}}分',
    } satisfies PluralMessage,
    ingredients: '材料',
    steps: '作り方',
    memo: 'メモ',
  },

  /** カレンダー表示。 */
  calendar: {
    title: 'カレンダー',
    loading: '調理記録を読み込んでいます',
    prevMonth: '前の月',
    nextMonth: '次の月',
    empty: 'この日の調理記録はありません',
    logCount: {
      one: '{{count}}件',
      other: '{{count}}件',
    } satisfies PluralMessage,
    /** 曜日の頭文字（日曜始まり）。 */
    weekdays: ['日', '月', '火', '水', '木', '金', '土'].join(','),
  },
};

export default ui;
