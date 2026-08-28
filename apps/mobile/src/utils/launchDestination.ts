/**
 * 起動直後にどこへ行くかを決める（R3 / Issue #114）。
 *
 * 起動経路が複数あり、**取り違えると「押したのと違う画面が開く」**という
 * いちばん困る壊れ方をするので、優先順位を1か所に固定する。
 */
export type LaunchDestination =
  /** 残量通知をタップして起動された → 買い物リストへ */
  | 'low-stock'
  /** 献立通知（#215 §10.11.4）をタップして起動された → 献立へ */
  | 'menu'
  /** 設定「アプリを開いたらすぐ撮影」がオン → 撮影へ */
  | 'capture'
  /** 通常どおりホーム */
  | 'home';

export function decideLaunchDestination(input: {
  tappedLowStockNotification: boolean;
  tappedMenuNotification?: boolean;
  launchCameraEnabled: boolean;
}): LaunchDestination {
  // 通知タップは**ユーザーの明示的な操作**なので、設定より必ず優先する
  // （2 つの通知が同時にタップされることは実際には無い — `getLastNotificationResponseAsync`
  // は直近の 1 件しか返さない。この優先順位は純関数としての決定性のためだけ）
  if (input.tappedLowStockNotification) return 'low-stock';
  if (input.tappedMenuNotification) return 'menu';
  if (input.launchCameraEnabled) return 'capture';
  return 'home';
}
