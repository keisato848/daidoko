/**
 * 画面に出してよいエラーかどうかの目印（`UserFacingError`）。
 *
 * 2026-08-19、写真取り込みで **Expo のネイティブ例外（Java の文言）がそのまま画面に出た**。
 * 再実行では成功したので一時的な失敗と見ているが、原因が何であれ利用者に生の文言を
 * 見せてはいけない。翻訳済みのエラーだけを通し、それ以外は受け皿の文言に寄せる。
 */
import { PhotoCaptureCancelledError, UserFacingError } from '../photo-capture.service';
import { VisionInferenceError } from '../vision-recipe.provider';

describe('UserFacingError', () => {
  it('Error として扱える（message と name を持つ）', () => {
    const error = new UserFacingError('カメラの権限がありません');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('カメラの権限がありません');
    expect(error.name).toBe('UserFacingError');
  });

  it('ネイティブ由来の素の Error とは区別できる（これが目印の存在理由）', () => {
    const native = new Error(
      'Call to function ExpoImagePicker.launchImageLibraryAsync has been rejected',
    );
    expect(native instanceof UserFacingError).toBe(false);
    expect(new UserFacingError('翻訳済み') instanceof UserFacingError).toBe(true);
  });

  it('キャンセルは別物として残す（無言で戻る扱いなので混ぜない）', () => {
    expect(new PhotoCaptureCancelledError() instanceof UserFacingError).toBe(false);
  });

  it('AI 側の翻訳済みエラーも画面に出してよい', () => {
    const vision = new VisionInferenceError('サーバーエラー (500)', true);
    expect(vision).toBeInstanceOf(Error);
    expect(vision.message).toBe('サーバーエラー (500)');
  });
});
