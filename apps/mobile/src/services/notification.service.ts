/**
 * Local notifications — used so the cooking timer alerts even when the app is
 * backgrounded (the in-app JS countdown is suspended in the background, so we
 * schedule an OS-level local notification for the timer's end time and cancel it
 * if the timer is paused/reset/finished early). No server / push involved.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isNativePlatform } from '../db/client';

const TIMER_CHANNEL_ID = 'timer';

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

/** Cancel a scheduled timer notification (no-op if already fired/absent). */
export async function cancelTimerNotification(id: string | null): Promise<void> {
  if (!isNativePlatform || !id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // already fired or cancelled — nothing to do
  }
}
