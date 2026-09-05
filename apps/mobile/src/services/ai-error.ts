/**
 * AI 呼び出しのエラーを**利用者向け文言**へ変換する共通口（`docs/品質基準.md`
 * 水平展開規約②・2026-09-05）。
 *
 * それまで各 provider が `サーバーエラー ({{status}})` を 10 箇所で焼き込み、
 * 画面によっては英語の生スタックがそのまま出ていた（2026-08-19 の写真取り込みで
 * 実際に出た）。ステータス→文言の対応と「見せてよいエラーか」の判定をここに集める。
 */
import { t } from '../i18n';
import { UserFacingError } from './photo-capture.service';

export interface ServerErrorInfo {
  message: string;
  retryable: boolean;
}

/**
 * HTTP ステータス → 利用者向け文言。
 * - 400/413: 送信データが大きすぎる（実機カメラ写真の 400 が典型 — 冷蔵庫写真設計 §8）
 * - 429: 混雑（共有レート上限）。待てば直るので retryable
 * - 5xx: サーバー側の問題。待つ以外にできることがないので retryable
 * - それ以外（404 等）: 従来の「サーバーエラー (n)」が最後の砦
 */
export function serverErrorFor(status: number): ServerErrorInfo {
  if (status === 400 || status === 413)
    return { message: t('ai.error.tooLarge'), retryable: false };
  if (status === 429) return { message: t('ai.error.busy'), retryable: true };
  if (status >= 500) return { message: t('ai.error.serverDown'), retryable: true };
  return { message: t('ai.error.serverError', { status }), retryable: false };
}

/**
 * 「利用者に見せてよい（= t() 済みの文言を持つ）」エラーか。
 * 各 provider のエラークラスは `readonly userVisible = true` の印を持つ。
 * 印の無い例外はネイティブモジュールの英語スタック等 — 素通しさせない。
 */
export function isUserVisibleError(error: unknown): error is Error {
  if (error instanceof UserFacingError) return true;
  return error instanceof Error && (error as { userVisible?: boolean }).userVisible === true;
}

/**
 * 画面に出してよい文言だけを返す（import-photo の readableError パターンの共通化）。
 * 見せられない例外は切り分け用にログへ残し、fallback（翻訳済みの一般文言）を返す。
 */
export function readableErrorMessage(error: unknown, fallback: string): string {
  if (isUserVisibleError(error)) return error.message;
  console.warn('[ai-error] unexpected error', error);
  return fallback;
}
