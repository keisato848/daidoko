/* global jest */
/**
 * Manual Jest mock for expo-notifications — keeps the native module out of unit
 * tests. Scheduling resolves to a fake id; permissions resolve granted.
 *
 * **実物と形を合わせること。** 2026-08-31 の監査で 3 点ずれていた:
 * - `AndroidImportance` の値が実物と別物だった（旧モック `HIGH:4` は実物の `LOW`、
 *   `DEFAULT:3` は実物の `MIN`）。しかも調理の常駐通知が使う `LOW` が無く、
 *   `AndroidImportance.LOW` が `undefined` のまま通ってしまう
 * - 権限の戻りに `granted` が無かった。`getPermissionsAsync().granted` を見る実装
 *   （`hasNotificationPermission`）が**テストでは常に false** になり、通知経路が一度も走らない
 * - `dismissNotificationAsync` が無い（`dismissCookingNotification` が使う）
 *
 * モックが実物とずれると、テストは「間違った振る舞い」を正解として固定する。
 * expo-notifications を上げたときはここも見ること。
 */
const grantedPermission = {
  status: 'granted',
  granted: true,
  expires: 'never',
  canAskAgain: true,
};

module.exports = {
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ ...grantedPermission })),
  requestPermissionsAsync: jest.fn(async () => ({ ...grantedPermission })),
  setNotificationChannelAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => 'mock-notification-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  dismissNotificationAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[mock]' })),
  // 実物（NotificationChannelManager.types）と同じ値
  AndroidImportance: {
    UNKNOWN: 0,
    UNSPECIFIED: 1,
    NONE: 2,
    MIN: 3,
    LOW: 4,
    DEFAULT: 5,
    HIGH: 6,
  },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
};
