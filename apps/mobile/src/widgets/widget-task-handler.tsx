/**
 * Android Headless タスク（W1・`docs/ウィジェット設計.md` §6-1 の本題）。
 *
 * react-native-android-widget は `registerWidgetTaskHandler` に渡した関数を、
 * ウィジェットの追加・更新・クリック等のたびに **Headless な JS プロセス**で
 * 呼び出す（expo-router のツリーの外）。ここでその Headless プロセスから
 * `expo-file-system/legacy` の `documentDirectory` が読めるかが R5 スパイクの
 * 検証対象 —「アプリが書いた `widget/snapshot.json` をウィジェット側が読めるか」。
 *
 * **読めなかった場合のフォールバック**（設計 §6-1）: 更新をアプリ起動時のみに
 * 劣化させる（`widget-snapshot.service.ts` が書く一方で、Headless 側は
 * `WIDGET_ADDED`/`WIDGET_UPDATE` のたびに読み直すのをやめ、アプリの
 * `requestWidgetUpdate()` 呼び出し — フォアグラウンド起動時 — にだけ頼る）。
 * **この分岐の実装はスパイク結果を見て管理役が判断する。ここでは読みにいく
 * 素直な実装のみ置く**。
 */
import * as FileSystem from 'expo-file-system/legacy';
import type { WidgetTaskHandler } from 'react-native-android-widget';

import { parseWidgetSnapshot } from '../utils/widgetSnapshot';
import type { WidgetSnapshot } from '../utils/widgetSnapshot';
import { ShoppingListWidget } from './ShoppingListWidget';
import { widgetSizeFromWidth } from './shoppingWidgetContent';

const SNAPSHOT_PATH = `${FileSystem.documentDirectory ?? ''}widget/snapshot.json`;

/** 読めない・壊れている場合は黙って null（ウィジェットは「案内文」を出す） */
async function readSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    const info = await FileSystem.getInfoAsync(SNAPSHOT_PATH);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(SNAPSHOT_PATH);
    return parseWidgetSnapshot(raw);
  } catch (error) {
    // Headless プロセスから documentDirectory が読めない環境の切り分け用
    // （スパイクの本題 — logcat で拾う）
    console.warn('[widget] snapshot read failed', error);
    return null;
  }
}

export const shoppingListWidgetTaskHandler: WidgetTaskHandler = async ({
  widgetAction,
  widgetInfo,
  renderWidget,
}) => {
  // 削除時は描画不要（ライブラリ側も無視する）
  if (widgetAction === 'WIDGET_DELETED') return;

  const snapshot = await readSnapshot();
  console.warn(
    '[widget] task handler',
    widgetAction,
    'snapshot:',
    snapshot ? `remaining=${snapshot.shopping.remaining}` : 'null',
  );

  renderWidget(
    <ShoppingListWidget snapshot={snapshot} size={widgetSizeFromWidth(widgetInfo.width)} />,
  );
};
