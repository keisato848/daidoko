/**
 * Local notifications — used so the cooking timer alerts even when the app is
 * backgrounded (the in-app JS countdown is suspended in the background, so we
 * schedule an OS-level local notification for the timer's end time and cancel it
 * if the timer is paused/reset/finished early). Also carries the pantry
 * low-stock alert (P3) on its own channel. No server / push involved.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isNativePlatform } from '../db/client';

const TIMER_CHANNEL_ID = 'timer';
const LOW_STOCK_CHANNEL_ID = 'low-stock';
const LOW_STOCK_DATA_TYPE = 'low-stock';

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
      name: '調理タイマー',
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
        title: 'タイマー終了',
        body: '調理時間が終わりました。',
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
      name: '在庫の残量通知',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: '在庫がなくなりそうです',
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

/** Cancel a scheduled timer notification (no-op if already fired/absent). */
export async function cancelTimerNotification(id: string | null): Promise<void> {
  if (!isNativePlatform || !id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // already fired or cancelled — nothing to do
  }
}
