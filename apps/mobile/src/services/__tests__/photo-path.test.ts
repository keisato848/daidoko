/**
 * 写真パスの保存形式（相対）と解決。
 *
 * これが壊れると **iOS で写真が丸ごと消えて見える**（container UUID が更新で
 * 変わり、絶対パスが参照できなくなる。`<Image>` は無言で何も描かず、絵文字の
 * フォールバックはパスが null のときしか出ないので完全な空白になる）。
 */
import { resolvePhotoUri, toStoredPhotoPath } from '../photo-path';

const DOC_DIR = 'file:///data/user/0/com.daidoko.app/files/';

jest.mock('expo-file-system/legacy', () => ({
  get documentDirectory() {
    return 'file:///data/user/0/com.daidoko.app/files/';
  },
}));

describe('toStoredPhotoPath', () => {
  it('絶対パスから相対パスを取り出す', () => {
    expect(toStoredPhotoPath(`${DOC_DIR}recipe-photos/recipe-photo-1.jpg`)).toBe(
      'recipe-photos/recipe-photo-1.jpg',
    );
    expect(toStoredPhotoPath(`${DOC_DIR}cooking-photos/cooking-photo-2.jpg`)).toBe(
      'cooking-photos/cooking-photo-2.jpg',
    );
  });

  it('iOS の container UUID を含む古いパスも相対にできる', () => {
    const stale =
      'file:///var/mobile/Containers/Data/Application/1111-2222/Documents/recipe-photos/a.jpg';
    expect(toStoredPhotoPath(stale)).toBe('recipe-photos/a.jpg');
  });

  it('すでに相対なら変えない（冪等）', () => {
    expect(toStoredPhotoPath('recipe-photos/a.jpg')).toBe('recipe-photos/a.jpg');
    expect(toStoredPhotoPath(toStoredPhotoPath(`${DOC_DIR}recipe-photos/a.jpg`))).toBe(
      'recipe-photos/a.jpg',
    );
  });

  it('管理外の URI は触らない（壊すため）', () => {
    expect(toStoredPhotoPath('content://media/external/images/1')).toBe(
      'content://media/external/images/1',
    );
    expect(toStoredPhotoPath('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(toStoredPhotoPath('file:///tmp/ImagePicker/xyz.jpg')).toBe(
      'file:///tmp/ImagePicker/xyz.jpg',
    );
  });

  it('null / 空文字は null', () => {
    expect(toStoredPhotoPath(null)).toBeNull();
    expect(toStoredPhotoPath(undefined)).toBeNull();
    expect(toStoredPhotoPath('')).toBeNull();
  });
});

describe('resolvePhotoUri', () => {
  it('相対パスに現在の documentDirectory を前置する', () => {
    expect(resolvePhotoUri('recipe-photos/a.jpg')).toBe(`${DOC_DIR}recipe-photos/a.jpg`);
  });

  it('**古い絶対パスを現在の documentDirectory へ貼り替える**（iOS の本丸）', () => {
    const stale =
      'file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/cooking-photos/b.jpg';
    expect(resolvePhotoUri(stale)).toBe(`${DOC_DIR}cooking-photos/b.jpg`);
  });

  it('管理外の URI はそのまま返す', () => {
    expect(resolvePhotoUri('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(resolvePhotoUri('content://media/1')).toBe('content://media/1');
  });

  it('null / 空文字は null', () => {
    expect(resolvePhotoUri(null)).toBeNull();
    expect(resolvePhotoUri('')).toBeNull();
  });

  it('解決 → 保存 の往復で相対に戻る', () => {
    const resolved = resolvePhotoUri('recipe-photos/a.jpg');
    expect(toStoredPhotoPath(resolved)).toBe('recipe-photos/a.jpg');
  });
});
