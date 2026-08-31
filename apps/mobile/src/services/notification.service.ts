/**
 * Local notifications — used so the cooking timer alerts even when the app is
 * backgrounded (the in-app JS countdown is suspended in the background, so we
 * schedule an OS-level local notification for the timer's end time and cancel it
 * if the timer is paused/reset/finished early). Also carries the pantry
 * low-stock alert (P3) on its own channel. No server / push involved.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isNativePlatform } from '../db/client';
import { t } from '../i18n';

const TIMER_CHANNEL_ID = 'timer';
const LOW_STOCK_CHANNEL_ID = 'low-stock';
const LOW_STOCK_DATA_TYPE = 'low-stock';
const MENU_CHANNEL_ID = 'menu';
const MENU_DATA_TYPE = 'menu';

let handlerSet = false;
let permissionGranted: boolean | null = null;

function ensureHandler(): void {
  if (handlerSet) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  handlerSet = true;
}

/** Request notification permission (and set up the Android channel). Cached. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNativePlatform) return false;
  ensureHandler();

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(TIMER_CHANNEL_ID, {
      name: t('notification.timerChannel'),
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  if (permissionGranted === true) return true;
  let status = (await Notifications.getPermissionsAsync()).status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  permissionGranted = status === 'granted';
  return permissionGranted;
}

/**
 * Schedule a one-shot local notification `seconds` from now for the timer's end.
 * Returns the notification id (to cancel later), or null if unavailable/denied.
 */
export async function scheduleTimerNotification(seconds: number): Promise<string | null> {
  if (!isNativePlatform || seconds <= 0) return null;
  if (!(await ensureNotificationPermission())) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: t('notification.timerDoneTitle'),
        body: t('notification.timerDoneBody'),
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.ceil(seconds),
        channelId: TIMER_CHANNEL_ID,
      },
    });
  } catch {
    return null;
  }
}

/**
 * Present an immediate local notification for low pantry stock (P3).
 * Returns the notification id, or null if unavailable/denied.
 */
export async function presentLowStockNotification(body: string): Promise<string | null> {
  if (!isNativePlatform || !body) return null;
  if (!(await ensureNotificationPermission())) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(LOW_STOCK_CHANNEL_ID, {
      name: t('notification.lowStockChannel'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: t('notification.lowStockTitle'),
        body,
        sound: 'default',
        data: { type: LOW_STOCK_DATA_TYPE },
      },
      trigger: Platform.OS === 'android' ? { channelId: LOW_STOCK_CHANNEL_ID } : null,
    });
  } catch {
    return null;
  }
}

/**
 * Fire `onTap` when the user taps a low-stock notification while the app is
 * already running (foreground or backgrounded-but-alive). Returns the
 * subscription to remove on unmount. For the cold-start case (app launched BY
 * the tap), see `consumeLowStockLaunchTap`.
 */
export function addLowStockTapListener(onTap: () => void): { remove: () => void } {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    if (response.notification.request.content.data?.type === LOW_STOCK_DATA_TYPE) onTap();
  });
}

/**
 * Check whether the app was cold-launched by tapping a low-stock notification
 * (the response listener above is only registered after mount, so it misses
 * the launch-triggering tap). Call once on startup.
 */
export async function consumeLowStockLaunchTap(): Promise<boolean> {
  if (!isNativePlatform) return false;
  const response = await Notifications.getLastNotificationResponseAsync();
  return response?.notification.request.content.data?.type === LOW_STOCK_DATA_TYPE;
}

/** Cancel any scheduled local notification by id (no-op if already fired/absent). */
export async function cancelScheduledNotification(id: string | null): Promise<void> {
  if (!isNativePlatform || !id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // already fired or cancelled — nothing to do
  }
}

/** Cancel a scheduled timer notification (no-op if already fired/absent). */
export async function cancelTimerNotification(id: string | null): Promise<void> {
  await cancelScheduledNotification(id);
}

// ── 毎日の自動献立モード（#215 §10.11.4）───────────────────────────────────
// **one-shot を毎起動で 1 本だけ予約し直す。DAILY 繰り返しは使わない**
// — 開かなくなった利用者に届くのは最大 1 本で自然に止まる（設計の決定変更 E）。
// 文言は静的（料理名は載せない・予約後の在庫変化で嘘になるため）。

/**
 * 翌朝の献立通知を `seconds` 秒後に 1 本だけ予約する。
 * 呼び出し側（`menu-plan.service.ts`）が毎回、`cancelAllMenuNotifications` で
 * 既存の献立通知を掃いてから呼ぶ責務を持つ — ここでは予約するだけ。
 */
export async function scheduleMenuNotification(seconds: number): Promise<string | null> {
  if (!isNativePlatform || seconds <= 0) return null;
  if (!(await ensureNotificationPermission())) return null;
  if (Platform.OS === 'android') {
    // SCHEDULE_EXACT_ALARM は足さない（朝の案内は数分ずれてよい・審査面の負債にしない）
    await Notifications.setNotificationChannelAsync(MENU_CHANNEL_ID, {
      name: t('notification.menuChannel'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: t('notification.menuReadyTitle'),
        body: t('notification.menuReadyBody'),
        data: { type: MENU_DATA_TYPE },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.ceil(seconds),
        channelId: MENU_CHANNEL_ID,
      },
    });
  } catch {
    return null;
  }
}

/**
 * 予約済みの献立通知（`data.type === 'menu'`）を **OS の予約一覧を実際に見て** 全部取り消す。
 *
 * 以前は「前回予約した id を app_meta に 1 本だけ覚えておいて、それだけ消す」帳簿方式
 * だったが、`refreshMenuNotificationSchedule`（`menu-plan.service.ts`）が二重に走ると
 * 両方が同じ id を読んで両方 cancel → 両方 schedule し、id の記録は後勝ちで
 * **先に予約した方が孤児化**した（AQUOS 実機・§10.11.4 の顛末）。
 * 掃引方式なら「今 OS に残っている type:menu の予約」を毎回全部消すので、
 * 二重予約が起きても・過去の版が残した孤児があっても、次に呼んだときに回収できる。
 */
export async function cancelAllMenuNotifications(): Promise<void> {
  if (!isNativePlatform) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const menuOnes = scheduled.filter((n) => n.content.data?.type === MENU_DATA_TYPE);
    await Promise.all(
      menuOnes.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch {
    // 一覧取得・キャンセルの失敗は致命ではない（次回起動時にまた掃く）
  }
}

/** 前面/バックグラウンドで献立通知をタップしたときに `onTap` を呼ぶ。 */
export function addMenuTapListener(onTap: () => void): { remove: () => void } {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    if (response.notification.request.content.data?.type === MENU_DATA_TYPE) onTap();
  });
}

/** 献立通知のタップでコールドスタートされたか。起動時に一度だけ呼ぶ。 */
export async function consumeMenuLaunchTap(): Promise<boolean> {
  if (!isNativePlatform) return false;
  const response = await Notifications.getLastNotificationResponseAsync();
  return response?.notification.request.content.data?.type === MENU_DATA_TYPE;
}

// ── クラウド同期の変更通知（S1 — docs/クラウド同期設計.md §7）───────────────
// サーバーが送るのは**内容を持たない同期のきっかけ**（§0-2 の判定どおり、利用者名も
// データ内容も載せない）。届かなくても起動時・フォアグラウンド復帰の pull で追いつく。

const SYNC_DATA_TYPE = 'sync';

function isSyncNotification(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === SYNC_DATA_TYPE
  );
}

/**
 * この端末の Expo Push トークン。取れなければ null（通知が来ないだけで同期は動く）。
 *
 * `projectId` は app.json の `extra.eas.projectId`。ここが空だと SDK 側が投げるので、
 * 先に確かめてから呼ぶ。エミュレータや権限拒否でも null に倒れる。
 */
export async function getExpoPushToken(): Promise<string | null> {
  if (!isNativePlatform) return null;
  if (!(await ensureNotificationPermission())) return null;
  return readExpoPushToken();
}

/**
 * **許可を求めずに**トークンを取る。まだ許可されていなければ null。
 *
 * 同期の変更通知はいちばん優先度の低い通知（届かなくても pull で追いつく — 設計 §7）。
 * その登録のために起動直後に OS の許可ダイアログを出すと、理由の分からない利用者は
 * 反射的に断る。iOS は一度断られると設定アプリまで行かないと戻せず、
 * **料理中タイマーの通知まで二度と出せなくなる**。許可はタイマーや残量通知のように
 * 「いま何に使うか」が見えている場面でだけ求める。
 */
export async function getExpoPushTokenIfPermitted(): Promise<string | null> {
  if (!isNativePlatform) return null;
  try {
    const status = (await Notifications.getPermissionsAsync()).status;
    if (status !== 'granted') return null;
  } catch {
    return null;
  }
  ensureHandler();
  return readExpoPushToken();
}

async function readExpoPushToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.['eas']?.projectId as string | undefined;
  if (!projectId) return null;
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data || null;
  } catch {
    return null;
  }
}

/**
 * 同期の変更通知を受け取ったら `onSync` を呼ぶ。
 * 前面で受け取った場合（received）と、通知をタップした場合（response）の両方を拾う。
 */
export function addSyncPushListener(onSync: () => void): { remove: () => void } {
  const received = Notifications.addNotificationReceivedListener((notification) => {
    if (isSyncNotification(notification.request.content.data)) onSync();
  });
  const response = Notifications.addNotificationResponseReceivedListener((event) => {
    if (isSyncNotification(event.notification.request.content.data)) onSync();
  });
  return {
    remove: () => {
      received.remove();
      response.remove();
    },
  };
}
