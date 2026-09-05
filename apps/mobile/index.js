import 'expo-router/entry';

// ウィジェット（W1 買い物リスト・W2 献立・Android）。expo-router のツリー外で
// Headless プロセスから呼ばれるため、通常の画面コンポーネントとは別に配線する
// （docs/ウィジェット設計.md §6-1）。ハンドラ内で widgetName により出し分ける。
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { daidokoWidgetTaskHandler } from './src/widgets/widget-task-handler';

registerWidgetTaskHandler(daidokoWidgetTaskHandler);
