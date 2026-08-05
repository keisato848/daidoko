/**
 * 起動直後にどこへ行くかを決める（R3 / Issue #114）。
 *
 * 起動経路が複数あり、**取り違えると「押したのと違う画面が開く」**という
 * いちばん困る壊れ方をするので、優先順位を1か所に固定する。
 */
export type LaunchDestination =
  /** 残量通知をタップして起動された → 買い物リストへ */
  | 'low-stock'
  /** 設定「アプリを開いたらすぐ撮影」がオン → 撮影へ */
  | 'capture'
  /** 通常どおりホーム */
  | 'home';

export function decideLaunchDestination(input: {
  tappedLowStockNotification: boolean;
  launchCameraEnabled: boolean;
}): LaunchDestination {
  // 通知タップは**ユーザーの明示的な操作**なので、設定より必ず優先する
  if (input.tappedLowStockNotification) return 'low-stock';
  if (input.launchCameraEnabled) return 'capture';
  return 'home';
}
