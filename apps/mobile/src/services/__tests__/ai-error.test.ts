/**
 * AI エラーの共通変換（水平展開規約②）。
 * - ステータス→文言の対応表（400/413=大きすぎ・429=混雑・5xx=時間をおいて）
 * - 「見せてよいエラー」判定（userVisible の印が無い例外は素通しさせない）
 */
import { t } from '../../i18n';
import { readableErrorMessage, serverErrorFor } from '../ai-error';
import { UserFacingError } from '../photo-capture.service';

describe('serverErrorFor — ステータス→文言の対応表', () => {
  it.each([
    [400, 'ai.error.tooLarge', false],
    [413, 'ai.error.tooLarge', false],
    [429, 'ai.error.busy', true],
    [500, 'ai.error.serverDown', true],
    [503, 'ai.error.serverDown', true],
  ] as const)('%d → %s (retryable=%s)', (status, key, retryable) => {
    expect(serverErrorFor(status)).toEqual({ message: t(key), retryable });
  });

  it('どれにも当たらないステータス（404 等）は従来の「サーバーエラー (n)」', () => {
    expect(serverErrorFor(404)).toEqual({
      message: t('ai.error.serverError', { status: 404 }),
      retryable: false,
    });
  });
});

describe('readableErrorMessage — 見せてよい文言だけを返す', () => {
  it('userVisible の印を持つエラーは message をそのまま返す', () => {
    class MarkedError extends Error {
      readonly userVisible = true;
    }
    expect(readableErrorMessage(new MarkedError('翻訳済みの文言'), 'fallback')).toBe(
      '翻訳済みの文言',
    );
  });

  it('UserFacingError（photo-capture）も見せてよい', () => {
    expect(readableErrorMessage(new UserFacingError('カメラの許可が必要です'), 'fallback')).toBe(
      'カメラの許可が必要です',
    );
  });

  it('印の無い生エラー（ネイティブの英語スタック等）は fallback に倒す', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readableErrorMessage(new Error('java.lang.RuntimeException: boom'), 'fallback')).toBe(
      'fallback',
    );
    expect(readableErrorMessage('not-an-error', 'fallback')).toBe('fallback');
    spy.mockRestore();
  });
});
