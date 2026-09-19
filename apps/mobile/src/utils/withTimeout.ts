/**
 * 時間内に終わらなければ `fallback` で先へ進む。**元の処理は止めない**（止める手段が無い物に使う）。
 *
 * 使いどころは「あれば嬉しいが、無くても本筋は進められる」もの。例: push トークンの取得 —
 * FCM が応答しない端末（Google Play 開発者サービスが無い・圏外・エミュレータ）では
 * `getExpoPushTokenAsync` が**返ってこない**ことがあり、待つと本筋（一括生成の投入）まで
 * 永久に止まる（2026-09-19 エミュレータで検出。ボタンのスピナーが回り続けた）。
 *
 * 失敗（reject）も `fallback` に倒す。呼び出し側に try/catch を要求しない。
 */
export function withTimeout<T, F>(work: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise<T | F>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
