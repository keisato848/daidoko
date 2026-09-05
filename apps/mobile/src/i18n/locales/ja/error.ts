/**
 * 失敗したときの文言。**ほぼ全部が A 階層**。
 *
 * 理由: 失敗の文言は「次に何をすればよいか」を決める。オフラインなら再接続、
 * 枠切れなら待つ、混雑なら少し待って再試行 — **取るべき行動が違う**ので、
 * 翻訳で混ざると #120 で作った区別が無に帰す。
 */
import type { CriticalMessage } from '../../types';

const error = {
  /** DB 初期化失敗（起動時）。詳細は console にのみ残す — 英語の生スタックを画面に出さない */
  dbInit:
    'データの読み込みに失敗しました。アプリを再起動してください。直らない場合は再インストールの前に、設定 > バックアップからデータを保存してください。',

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

  /**
   * 想定外の失敗（多くはネイティブ側の一時的な例外）。**原因を説明しない**。
   * 実際に Expo の Java 例外がそのまま画面に出た（2026-08-19・再実行では成功）ので、
   * 生の文言を見せない受け皿として置く。
   */
  photoRecipeUnexpected: '写真をうまく読み込めませんでした。少し時間をおいてからお試しください。',

  /** 原因が分からないときの汎用。**具体的な原因を騙らない**ことが役目。 */
  photoRecipeFailed: {
    text: '写真からレシピをつくれませんでした。もう一度お試しください。',
    intent:
      'Generic fallback when the cause is unknown. MUST NOT claim a specific cause ' +
      '(network, quota, congestion) — the whole point is that we do not know which it was.',
  } satisfies CriticalMessage,

  /**
   * 料理として認識できなかったとき。**失敗ではなく被写体の問題**なので、
   * 「もう一度」ではなく「どんな写真なら通るか」を伝える。
   */
  notADish: {
    text: '写真から料理を認識できませんでした。料理がはっきり写った写真でお試しください。',
    intent:
      'MUST convey that the PHOTO is the problem and describe what a usable photo looks like. ' +
      'MUST NOT be a bare "try again" — retrying with the same photo cannot succeed.',
  } satisfies CriticalMessage,

  /** 保存・読み込みなど、原因を特定できない一般的な失敗。 */
  generic: '問題が発生しました。もう一度お試しください。',
  saveFailed: '保存できませんでした',
  loadFailed: '読み込めませんでした',
  photoStorageUnavailable: '写真の保存先を取得できませんでした',
  imageTooSmall: '画像が小さすぎます',
  imageTooLarge: '画像サイズが大きすぎます',
  cameraPermissionDenied: 'カメラの使用が許可されていません',
};

export default error;
