import 'expo-router/entry';

// ウィジェット（W1 買い物リスト・W2 献立・Android）。expo-router のツリー外で
// Headless プロセスから呼ばれるため、通常の画面コンポーネントとは別に配線する
// （docs/ウィジェット設計.md §6-1）。ハンドラ内で widgetName により出し分ける。
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { registerSyncBackgroundTask } from './src/tasks/sync-background.task';
import { daidokoWidgetTaskHandler } from './src/widgets/widget-task-handler';

registerWidgetTaskHandler(daidokoWidgetTaskHandler);

// 家族の変更を、アプリを開かずにウィジェットへ映す（受付票 D-3）。**タスクの定義は
// モジュールの最上位で済んでいる必要がある** — アプリが終了した状態で OS に起こされたとき、
// 画面（_layout.tsx）は走らないので、入口のここで読み込む（docs/ウィジェット設計.md §11）。
void registerSyncBackgroundTask();
