/**
 * Brand colors and theme constants for だいどこ
 */
export const Colors = {
  bg: '#0A0805',
  bgCard: '#130C06',
  bgInput: '#1C1409',
  bgOverlay: 'rgba(10,8,5,0.85)',
  border: '#2E2418',
  borderLight: '#3D3020',
  gold: '#C9A16A',
  goldDim: '#A07A44',
  paper: '#F0E6D2',
  paperDim: '#DCC9A8',
  muted: '#5A4A34',
  white: '#FFFFFF',
} as const;

export const Fonts = {
  brand: 'Cormorant Garamond',
  system: 'System',
} as const;

/**
 * Typography scale — 画面設計.md §タイポグラフィ 参照
 *
 * サイズ指針:
 *   wordmark : 9   — DAIDOKO 装飾テキスト（意図的な最小表示、可読性より審美性優先）
 *   xxs      : 11  — タグチップ・Coming Soon など最小補助ラベル
 *   xs       : 12  — タイムスタンプ・メタ情報・グループラベル
 *   sm       : 13  — フォームラベル・カード副情報・補足テキスト
 *   base     : 15  — 本文（材料名・手順・カードタイトル・設定項目）
 *   md       : 17  — セクションヘッダー・ボタン CTA
 *   lg       : 20  — 画面タイトル・レシピ名（詳細）・料理中ステップ番号
 *   xl       : 24  — ヒーロー数値
 *   timer    : 36  — タイマーカウントダウン数値
 *
 * ウェイト指針:
 *   regular  : '400' — 本文・補足・説明
 *   medium   : '500' — カードタイトル・セクションヘッダー・画面タイトル
 *   semibold : '600' — ボタン CTA・強調ラベル・タイマー数値
 */
export const Typography = {
  size: {
    wordmark: 9,
    xxs: 11,
    xs: 12,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
    timer: 36,
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
  },
} as const;
