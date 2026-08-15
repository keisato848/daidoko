/**
 * 端末内 OCR の文字起こし（`docs/在庫・レシート設計レビュー.md` §3.4）。
 *
 * ML Kit は unbundled なので「モジュールはあるが、モデルがまだ無い」状態があり、
 * **初回起動時はたいていそれ**。ここが例外を投げると、その生の英語メッセージが
 * レシート画面に出る（症状2）。読めなかったことは `null` で表し、呼び出し側は
 * 1つの答えだけを見て画像経路へ落とせる、という約束を固定する。
 */
import { NativeModules, Platform } from 'react-native';

import { recognizeTextOnDevice } from '../client-ocr.provider';

const isAvailable = jest.fn<Promise<boolean>, []>();
const recognizeImage = jest.fn();

function installNativeModule(module: unknown): void {
  (NativeModules as unknown as Record<string, unknown>)['DaidokoOcr'] = module;
}

describe('recognizeTextOnDevice', () => {
  beforeEach(() => {
    Platform.OS = 'android';
    isAvailable.mockReset().mockResolvedValue(true);
    recognizeImage.mockReset().mockResolvedValue({ rawText: '牛乳 2本 ¥398', blocks: [] });
    installNativeModule({ isAvailable, recognizeImage });
  });

  afterEach(() => {
    installNativeModule(undefined);
  });

  it('読み取れたテキストを返す', async () => {
    await expect(recognizeTextOnDevice('file:///receipt.jpg')).resolves.toBe('牛乳 2本 ¥398');
  });

  it('モデルが未取得（isAvailable=false）なら認識を呼ばずに null', async () => {
    isAvailable.mockResolvedValue(false);
    await expect(recognizeTextOnDevice('file:///receipt.jpg')).resolves.toBeNull();
    expect(recognizeImage).not.toHaveBeenCalled();
  });

  it('可用性の問い合わせ自体が失敗しても投げずに null', async () => {
    isAvailable.mockRejectedValue(
      new Error('Waiting for the text optional module to be downloaded'),
    );
    await expect(recognizeTextOnDevice('file:///receipt.jpg')).resolves.toBeNull();
  });

  it('認識が失敗しても投げずに null（生の ML Kit エラーを画面に出さない）', async () => {
    recognizeImage.mockRejectedValue(new Error('OCR_FAILED'));
    await expect(recognizeTextOnDevice('file:///receipt.jpg')).resolves.toBeNull();
  });

  it('1文字も読めなかったときも null（空文字を「読めた」にしない）', async () => {
    recognizeImage.mockResolvedValue({ rawText: '   \n ', blocks: [] });
    await expect(recognizeTextOnDevice('file:///receipt.jpg')).resolves.toBeNull();
  });

  it('ネイティブモジュールが無い端末では null', async () => {
    installNativeModule(undefined);
    await expect(recognizeTextOnDevice('file:///receipt.jpg')).resolves.toBeNull();
  });

  it('iOS では端末内 OCR を持たないので null（Apple Vision は #58）', async () => {
    Platform.OS = 'ios';
    await expect(recognizeTextOnDevice('file:///receipt.jpg')).resolves.toBeNull();
    expect(isAvailable).not.toHaveBeenCalled();
  });
});
