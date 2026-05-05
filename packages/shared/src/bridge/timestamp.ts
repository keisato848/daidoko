/**
 * timestamp utilities — 高精度タイムスタンプの取得と計算
 */

/** 現在のタイムスタンプを取得（wallTime + perfMark） */
export function captureTimestamp(): { wallTime: string; perfMark: number } {
  return {
    wallTime: new Date().toISOString(),
    perfMark: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
}

/** 2つの perfMark 間の経過時間を ms で返す */
export function elapsedMs(startMark: number, endMark: number): number {
  return Math.round((endMark - startMark) * 100) / 100;
}
