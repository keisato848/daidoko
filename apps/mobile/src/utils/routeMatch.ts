/**
 * パスの「セグメント一致」判定。
 *
 * **`pathname.includes('/cook')` は `/cookable` にも当たる。**
 * 実際に Now Cooking バーが在庫の「作れるレシピ」画面（`/cookable`）で消える不具合を出した
 * （2026-08-31 の監査で発覚。**調理直前でいちばん復帰導線が要る画面**だった）。
 * 同じ書き方が app-open 広告の抑止判定にもあり、そちらは `/cookable` で広告が出ない
 * 方向に外していた（無害寄りだが誤り）。
 *
 * 部分一致ではなく **`/` で区切った 1 セグメントとして**一致させる。
 * ルート名の追加でしか壊れないので、`includes` より事故りにくい。
 */

/** `pathname` が `segment`（先頭の `/` は無視）をパスセグメントとして含むか。 */
export function pathHasSegment(pathname: string, segment: string): boolean {
  const target = segment.replace(/^\/+/, '');
  if (target === '') return false;
  return pathname.split('/').filter(Boolean).includes(target);
}

/** `segments` のいずれかを含むか。 */
export function pathHasAnySegment(pathname: string, segments: readonly string[]): boolean {
  return segments.some((segment) => pathHasSegment(pathname, segment));
}
