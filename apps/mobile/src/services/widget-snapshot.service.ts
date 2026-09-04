/**
 * ウィジェットへ渡すスナップショットの書き出し（W0・`docs/ウィジェット設計.md` §1）。
 *
 * 組み立ては `utils/widgetSnapshot` の純関数側。ここは**集めて書くだけ**。
 *
 * **書き出し先は 2 つ**。同じ JSON を両方に置く:
 * - Android: `documentDirectory/widget/snapshot.json`（Headless タスクが読む）
 * - iOS: App Group の UserDefaults キー `widget_snapshot`（拡張から読めるのはここだけ）
 *
 * ウィジェットが未導入のあいだ、この書き出しは**誰も読まない値を置くだけ**で
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
 * iOS の共有先。**Swift 側と app.json の 3 か所で同じ値**を使う:
 * - `app.json` の `ios.entitlements['com.apple.security.application-groups']`
 * - `targets/shopping-widget/ShoppingWidget.swift` の `appGroupIdentifier` / `snapshotKey`
 */
const IOS_APP_GROUP = 'group.com.daidoko.app';
const IOS_SNAPSHOT_KEY = 'widget_snapshot';
/** `ShoppingWidget.swift` の `StaticConfiguration(kind:)` と揃える */
const IOS_WIDGET_KIND = 'ShoppingWidget';

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
    // 要求日数（不足行用・§2）。旧プランには保存されていない → null（不足行は出ない）
    requestedDays: menu?.plan.requestedDays ?? null,
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
  await pushToIosWidget(snapshot);
}

/**
 * iOS は App Group の UserDefaults に同じ JSON を置く（W1-iOS・設計 §1）。
 *
 * **`documentDirectory` は拡張から読めない** — ウィジェットは別プロセス・別サンドボックスで
 * 動くので、共有できるのは App Group だけ。Android と同じ JSON 文字列を 1 本置き、
 * Swift 側（`targets/shopping-widget/ShoppingWidget.swift`）が
 * `UserDefaults(suiteName:)` で読む。
 *
 * 書いたあと `reloadWidgets()` を呼ばないと、WidgetKit のタイムライン（30 分間隔）まで
 * 反映されない。Android の `requestWidgetUpdate` と同じ役割。
 *
 * **書き込みは自前のローカルモジュール**（`modules/daidoko-widget-storage`）で持つ。
 * `@bacons/apple-targets` の ExtensionStorage は autolinking に拾われず、しかも
 * ネイティブ不在時に黙って no-op になるため、書けていないことに気づけない
 * （設計 §7）。自前側は書けなかったら警告を 1 回出す。
 *
 * ホーム画面に未追加でも無害（対象 0 件で何もしない）。失敗しても
 * `documentDirectory` への書き出しは済んでいるので、本体は巻き込まない。
 */
async function pushToIosWidget(snapshot: WidgetSnapshot): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const { setWidgetSnapshot, reloadWidgets } =
      await import('../../modules/daidoko-widget-storage');
    const written = setWidgetSnapshot(IOS_SNAPSHOT_KEY, JSON.stringify(snapshot), IOS_APP_GROUP);
    // 書けていないのに再読み込みを促しても、古い姿を出し直すだけ
    if (written) reloadWidgets(IOS_WIDGET_KIND);
  } catch {
    // モジュール未リンクでも本体機能は継続させる（警告はモジュール側が出す）
  }
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
    const { MenuWidget } = await import('../widgets/MenuWidget');
    const { menuWidgetSize } = await import('../widgets/menuWidgetContent');
    await requestWidgetUpdate({
      widgetName: 'ShoppingList',
      renderWidget: (info) =>
        React.createElement(ShoppingListWidget, {
          snapshot,
          size: widgetSizeFromWidth(info.width),
        }),
    });
    // 献立ウィジェット（W2）も同じスナップショットで即時反映する。
    // ホーム画面に未追加なら対象 0 件で無害。
    await requestWidgetUpdate({
      widgetName: 'Menu',
      renderWidget: (info) =>
        React.createElement(MenuWidget, {
          snapshot,
          size: menuWidgetSize(info.width, info.height),
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
