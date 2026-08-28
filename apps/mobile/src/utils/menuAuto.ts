/**
 * 毎日の自動献立モード（#215 A1）の純関数群 — 設定の既定値と、通知の秒数計算。
 *
 * `utils/menuPlan.ts` はレシピ・在庫の型に依存する採点/ローリングのロジックを持つ。
 * ここは**それらに依存しない小さな計算**（既定値・時刻の文字列化・one-shot 通知までの秒数）
 * だけを置く。設計は `docs/買い物リスト・在庫設計.md` §10.11。
 */

/** 何日分を保つか（ローリングの窓幅 X）の既定。親トグルは既定オフ（§10.11.2） */
export const MENU_AUTO_DEFAULT_DAYS = 3;
/** 選べる日数の範囲。既存の手動画面の選択肢（2/3/5/7）と揃える必要は無いが、範囲だけ揃える */
export const MENU_AUTO_MIN_DAYS = 2;
export const MENU_AUTO_MAX_DAYS = 7;

export interface MenuAutoNotifyTime {
  hour: number;
  minute: number;
}

/** 通知時刻の既定=7:00（§10.11 冒頭）。 */
export const MENU_AUTO_DEFAULT_NOTIFY_TIME: MenuAutoNotifyTime = { hour: 7, minute: 0 };

/** 保存する日数が妥当な範囲か。壊れた/古い保存値を既定へ倒すための判定。 */
export function isValidMenuAutoDays(value: number): boolean {
  return Number.isInteger(value) && value >= MENU_AUTO_MIN_DAYS && value <= MENU_AUTO_MAX_DAYS;
}

/** `"7:0"` 形式で永続化する（`app_meta` は文字列しか持てない）。 */
export function formatMenuAutoNotifyTime(time: MenuAutoNotifyTime): string {
  return `${time.hour}:${time.minute}`;
}

/** 保存値の読み戻し。壊れている/範囲外なら null（呼び出し側は既定値へ倒す）。 */
export function parseMenuAutoNotifyTime(raw: string): MenuAutoNotifyTime | null {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * `now` から見て次の `hour:minute`（端末のローカル時刻）までの秒数。
 * その時刻を**今日すでに過ぎていたら翌日**にする（日跨ぎ・§10.11.4 の「翌 HH:MM までの秒数」）。
 * ちょうど一致する瞬間（0 秒）は「過ぎた」側に倒して翌日にする——0 秒の通知予約は
 * 一部プラットフォームで即時発火の扱いになり得るため、常に未来の 1 本にする。
 */
export function secondsUntilNextMenuNotifyTime(
  now: Date,
  time: MenuAutoNotifyTime = MENU_AUTO_DEFAULT_NOTIFY_TIME,
): number {
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    time.hour,
    time.minute,
    0,
    0,
  );
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return Math.round((next.getTime() - now.getTime()) / 1000);
}
