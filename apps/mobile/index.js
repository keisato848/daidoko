import 'expo-router/entry';

// 買い物リストウィジェット（W1・Android）。expo-router のツリー外で Headless
// プロセスから呼ばれるため、通常の画面コンポーネントとは別に配線する
// （docs/ウィジェット設計.md §6-1）。
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { shoppingListWidgetTaskHandler } from './src/widgets/widget-task-handler';

registerWidgetTaskHandler(shoppingListWidgetTaskHandler);
