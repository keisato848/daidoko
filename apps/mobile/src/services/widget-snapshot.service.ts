/**
 * ウィジェットへ渡すスナップショットの書き出し（W0・`docs/ウィジェット設計.md` §1）。
 *
 * 組み立ては `utils/widgetSnapshot` の純関数側。ここは**集めて書くだけ**。
 *
 * **書き出し先はまだ Android 側だけ**（`documentDirectory/widget/snapshot.json`）。
 * iOS の App Group（`ExtensionStorage`）は `@bacons/apple-targets` を入れてからで、
 * それは prebuild を伴うので別リリース（R5）。**いま入れておく理由**は、
 * ウィジェット本体より先に「書く側」を安定させておくと、スパイクで確かめるのが
 * 「読めるか」だけになるため。
 *
 * ウィジェットが未導入のあいだ、この書き出しは**誰も読まないファイルを作るだけ**で
 * 害が無い（`documentDirectory` はクラウドバックアップの include 対象外なので
 * 除外作業も要らない — 設計 §1 の検証反映）。
 *
 * **Android は書いた直後に画面上のウィジェットも押し更新する**（設計 §1:
 * 「Android は documentDirectory/widget/snapshot.json＋requestWidgetUpdate()」）。
 * `react-native-android-widget` は R5 で依存追加したので、書く関数からここで
 * 初めて呼べる。無ければ `updatePeriodMillis` の下限（30分）まで古い表示のまま
 * になってしまう。ホーム画面に未追加でも `requestWidgetUpdate` は無害（対象 0 件で
 * 何もしない）。
 */
import { Platform } from 'react-native';
import React from 'react';

import { buildWidgetSnapshot, type WidgetSnapshot } from '../utils/widgetSnapshot';
import { isNativePlatform } from '../db/client';

/** 書き出し先。Android の Headless タスクから読む想定 */
const WIDGET_DIR = 'widget';
const SNAPSHOT_FILE = 'snapshot.json';

/**
 * 連打で書き潰さないためのデバウンス。買い物リストのチェックは連続で起きる
 * （設計 §1 は 500ms）。
 */
const DEBOUNCE_MS = 500;
let pending: ReturnType<typeof setTimeout> | null = null;

/** 現在の状態からスナップショットを組む。**空でも必ず 1 本作る** */
async function collect(): Promise<WidgetSnapshot | null> {
  if (!isNativePlatform) return null;
  const { getShoppingItems } = await import('./shopping-list.service');
  const { getMenuPlan } = await import('./menu-plan.service');
  const { getLocale } = await import('../i18n');

  const [shoppingItems, menu] = await Promise.all([
    getShoppingItems().catch(() => []),
    getMenuPlan().catch(() => null),
  ]);

  return buildWidgetSnapshot({
    shoppingItems,
    menuDays: menu?.days ?? [],
    // 自動モード（§10.11）で組まれたプランだけが anchorDate を持つ。
    // 手動プランは null のまま = 「次の一品」（ホームカードと同じ規約・§2）
    anchorDate: menu?.plan.anchorDate ?? null,
    locale: getLocale(),
    now: new Date(),
  });
}

async function write(snapshot: WidgetSnapshot): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const dir = `${FileSystem.documentDirectory ?? ''}${WIDGET_DIR}`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  await FileSystem.writeAsStringAsync(`${dir}/${SNAPSHOT_FILE}`, JSON.stringify(snapshot));
  await pushToAndroidWidget(snapshot);
}

/**
 * 書いた直後に、ホーム画面に追加済みのウィジェットへ即時反映する（Android のみ）。
 * 失敗しても書き出し自体は成功しているので、ここは黙って諦める（Headless の
 * `WIDGET_UPDATE`/`updatePeriodMillis` がフォールバックとして残る）。
 */
async function pushToAndroidWidget(snapshot: WidgetSnapshot): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const { requestWidgetUpdate } = await import('react-native-android-widget');
    const { ShoppingListWidget } = await import('../widgets/ShoppingListWidget');
    const { widgetSizeFromWidth } = await import('../widgets/shoppingWidgetContent');
    await requestWidgetUpdate({
      widgetName: 'ShoppingList',
      renderWidget: (info) =>
        React.createElement(ShoppingListWidget, {
          snapshot,
          size: widgetSizeFromWidth(info.width),
        }),
    });
  } catch {
    // ホーム画面に未追加・ライブラリ未初期化でも本体機能は継続させる
  }
}

/**
 * 状態が変わったときに呼ぶ。**失敗しても呼び出し側を巻き込まない** —
 * ウィジェットの鮮度のために買い物リストの操作が失敗しては本末転倒。
 */
export function refreshWidgetSnapshot(): void {
  if (!isNativePlatform) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void (async () => {
      try {
        const snapshot = await collect();
        if (snapshot) await write(snapshot);
      } catch {
        // ウィジェットは無くても本体は動く。黙って諦める
      }
    })();
  }, DEBOUNCE_MS);
}

/** テスト・実機確認用。デバウンスを待たずに 1 回書く */
export async function writeWidgetSnapshotNow(): Promise<WidgetSnapshot | null> {
  const snapshot = await collect();
  if (snapshot) await write(snapshot).catch(() => undefined);
  return snapshot;
}
