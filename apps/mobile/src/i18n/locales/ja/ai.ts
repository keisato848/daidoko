/**
 * AI 呼び出しまわりの文言。**写真からレシピ・レシピ調整・レシート読み取りで共通**。
 *
 * プロンプト本体はここに置かない（対象国ごとの書き換えが必要で、
 * 翻訳とは別の作業になる — 設計 §7・P3）。ここはあくまで画面に出る文言。
 */
import type { CriticalMessage } from '../../types';

const ai = {
  /**
   * AI が推定したものだと伝える注意書き。**安全に関わる**ので A 階層。
   * アレルゲンの検出・警告は行わない方針なので、確認の責任が利用者にあることを明示する
   * （`docs/privacy-policy.md` §7）。
   */
  disclaimer: {
    text: 'AIが推定したレシピです。材料・分量・手順は必ずご確認ください（アレルギーのある方は特にご注意ください）。',
    intent:
      'MUST convey that the recipe is AI-generated and UNVERIFIED, and that the user must check ' +
      'ingredients, amounts and steps themselves. MUST keep the allergy warning explicit — ' +
      'the app does NOT detect allergens, so this sentence is the only warning the user gets. ' +
      'MUST NOT be softened into a generic "powered by AI" note.',
  } satisfies CriticalMessage,

  error: {
    /** BYOK のキーが無効・権限不足。**待っても直らない**ので、キーを見るよう促す。 */
    apiKey: {
      text: 'APIキーを確認してください（無効・権限不足の可能性）',
      intent:
        'MUST direct the user to check their own API key. MUST NOT be confusable with a ' +
        'temporary failure — waiting or retrying cannot fix an invalid key.',
    } satisfies CriticalMessage,

    /**
     * BYOK のキーが上限に達した。**サーバーの上限とは別物**で、
     * 直すのは利用者自身の Google Cloud 側。
     */
    byokQuota: {
      text: 'ご自身の Gemini キーの利用上限に達しました。時間をおいてお試しください。',
      intent:
        "MUST make clear the limit is on the user's OWN Gemini key, not this app's quota. " +
        'MUST convey that waiting is the remedy. MUST NOT be confusable with a network failure.',
    } satisfies CriticalMessage,

    noResult: 'AIから結果を取得できませんでした',
    unparsable: 'AIの応答を解析できませんでした',
    serverError: 'サーバーエラー ({{status}})',
    timeout: 'リクエストがタイムアウトしました',
    unreachable: 'AIにつながりませんでした（{{reason}}）',
    imageLoadFailed: '画像の読み込みに失敗しました',
    draftConvertFailed: 'レシピ下書きに変換できませんでした',
  },
};

export default ai;
