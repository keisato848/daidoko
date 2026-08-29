/**
 * AI 生成コンテンツの「アプリ内報告」（docs/レシピ表紙AI生成設計.md §6）。
 *
 * Play の AI 生成コンテンツポリシー（"without needing to exit the app"）を満たすための
 * 1 画面。個人情報は受け取らない（サーバー側 zod もカテゴリ＋短文だけ）。
 */
const report = {
  title: '問題を報告',
  lead: 'AIが作った内容に問題があれば教えてください。個人情報は入力しないでください。',
  categoryLabel: '種類',
  categoryInappropriate: '不適切な内容',
  categoryInaccurate: '事実と違う・おかしい',
  categoryOther: 'その他',
  textLabel: '詳細（任意）',
  textPlaceholder: '気になった点を書いてください',
  submit: '送信する',
  submitting: '送信しています…',
  sentTitle: '送信しました',
  sentBody: 'ご報告ありがとうございました。',
  failedTitle: 'お知らせ',
  failedBody: '送信できませんでした。時間をおいてお試しください。',
};

export default report;
