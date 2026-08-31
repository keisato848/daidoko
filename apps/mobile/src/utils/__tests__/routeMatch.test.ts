/**
 * セグメント一致の不変条件。
 *
 * **`/cookable` が `/cook` に当たらないこと**が本丸。
 * `includes` に戻すとここが赤くなる（2026-08-31 の実バグ — Now Cooking バーが
 * 在庫の「作れるレシピ」画面で消えていた）。
 */
import { pathHasAnySegment, pathHasSegment } from '../routeMatch';

describe('pathHasSegment', () => {
  it('セグメントとして一致する', () => {
    expect(pathHasSegment('/recipes/abc-123/cook', 'cook')).toBe(true);
    expect(pathHasSegment('/recipes/abc-123/cook', '/cook')).toBe(true); // 先頭の / は無視
    expect(pathHasSegment('/(tabs)/recipes/abc/cook', 'cook')).toBe(true);
  });

  it('**部分一致では当たらない** — /cookable は /cook ではない', () => {
    expect(pathHasSegment('/cookable', 'cook')).toBe(false);
    expect(pathHasSegment('/(tabs)/cookable', '/cook')).toBe(false);
    // 逆向きも（/cook は /cookable ではない）
    expect(pathHasSegment('/recipes/abc/cook', 'cookable')).toBe(false);
  });

  it('前方・後方の部分文字列にも当たらない', () => {
    expect(pathHasSegment('/recipes/import-photo-old', 'import-photo')).toBe(false);
    expect(pathHasSegment('/pre-consult', 'consult')).toBe(false);
  });

  it('空・区切りだけの入力で誤検知しない', () => {
    expect(pathHasSegment('/', 'cook')).toBe(false);
    expect(pathHasSegment('/recipes/abc/cook', '')).toBe(false);
    expect(pathHasSegment('/recipes/abc/cook', '/')).toBe(false);
  });
});

describe('pathHasAnySegment', () => {
  const HIDDEN = ['/cook', '/import-photo', '/consult'];

  it('いずれかに当たれば true', () => {
    expect(pathHasAnySegment('/recipes/abc/cook', HIDDEN)).toBe(true);
    expect(pathHasAnySegment('/recipes/import-photo', HIDDEN)).toBe(true);
  });

  it('実在の隣接ルートに誤爆しない', () => {
    // (tabs)/cookable.tsx は実在するルート
    expect(pathHasAnySegment('/cookable', HIDDEN)).toBe(false);
    expect(pathHasAnySegment('/recipes', HIDDEN)).toBe(false);
    expect(pathHasAnySegment('/', HIDDEN)).toBe(false);
  });
});
