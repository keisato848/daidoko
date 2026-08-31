jest.mock('../../db/client', () => ({ isNativePlatform: true }));

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  addCookingResumeTapListener,
  addLowStockTapListener,
  cancelTimerNotification,
  consumeLowStockLaunchTap,
  dismissCookingNotification,
  ensureNotificationPermission,
  presentCookingNotification,
  presentLowStockNotification,
  scheduleTimerNotification,
} from '../notification.service';

describe('notification.service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not schedule for non-positive durations', async () => {
    expect(await scheduleTimerNotification(0)).toBeNull();
    expect(await scheduleTimerNotification(-5)).toBeNull();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules a one-shot notification and returns its id', async () => {
    const id = await scheduleTimerNotification(90);
    expect(id).toBe('mock-notification-id');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('cancels by id, and no-ops when id is null', async () => {
    await cancelTimerNotification('abc');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('abc');

    jest.clearAllMocks();
    await cancelTimerNotification(null);
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('reports permission granted', async () => {
    expect(await ensureNotificationPermission()).toBe(true);
  });

  it('presents an immediate low-stock notification', async () => {
    const id = await presentLowStockNotification('卵 の残りが少なくなっています。');
    expect(id).toBe('mock-notification-id');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('does not present an empty low-stock body', async () => {
    expect(await presentLowStockNotification('')).toBeNull();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('tags the low-stock notification with a data type for tap routing', async () => {
    await presentLowStockNotification('卵 の残りが少なくなっています。');
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.data).toEqual({ type: 'low-stock' });
  });

  describe('addLowStockTapListener', () => {
    it('invokes onTap only for low-stock notification responses', () => {
      const onTap = jest.fn();
      addLowStockTapListener(onTap);
      const handler = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock
        .calls[0][0];

      handler({ notification: { request: { content: { data: { type: 'low-stock' } } } } });
      expect(onTap).toHaveBeenCalledTimes(1);

      handler({ notification: { request: { content: { data: { type: 'timer' } } } } });
      expect(onTap).toHaveBeenCalledTimes(1);

      handler({ notification: { request: { content: { data: undefined } } } });
      expect(onTap).toHaveBeenCalledTimes(1);
    });
  });

  describe('consumeLowStockLaunchTap', () => {
    it('returns true when the app was launched by a low-stock notification tap', async () => {
      (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValueOnce({
        notification: { request: { content: { data: { type: 'low-stock' } } } },
      });
      expect(await consumeLowStockLaunchTap()).toBe(true);
    });

    it('returns false when there is no launch response', async () => {
      (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValueOnce(null);
      expect(await consumeLowStockLaunchTap()).toBe(false);
    });

    it('returns false for a differently-typed launch response', async () => {
      (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValueOnce({
        notification: { request: { content: { data: { type: 'timer' } } } },
      });
      expect(await consumeLowStockLaunchTap()).toBe(false);
    });
  });

  /**
   * 調理の常駐通知（Android のみ）。**壊れ方ごとに 1 件ずつ固定する** —
   * ここが 0% だと、次に触った人が沈黙で壊せる（2026-08-31 の監査で指摘）。
   */
  describe('調理の常駐通知', () => {
    // **Android 限定の機能。** jest-expo の既定プラットフォームは android ではないため、
    // 指定しないと全部が早期 return して「呼ばれていない」で落ちる（実際に落ちた）。
    // iOS は Live Activities の領分なので、この関数群は Android でしか動かないのが仕様
    const originalOS = Platform.OS;
    beforeEach(() => {
      Platform.OS = 'android';
    });
    afterAll(() => {
      Platform.OS = originalOS;
    });

    it('iOS では何もしない（sticky の概念が無く通知が積まれるだけ）', async () => {
      Platform.OS = 'ios';
      await presentCookingNotification('肉じゃが', '手順 1 / 5');
      await dismissCookingNotification();
      expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
      expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
    });

    it('identifier を固定して 1 本だけにする（手順移動で積まれない）', async () => {
      await presentCookingNotification('牛肉のカルパッチョ', '手順 2 / 7');
      await presentCookingNotification('牛肉のカルパッチョ', '手順 3 / 7');

      const calls = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      // 同じ identifier なら OS 側は上書き。外すと手順ごとに通知が積まれる
      expect(calls[0][0].identifier).toBe('cooking-session');
      expect(calls[1][0].identifier).toBe('cooking-session');
    });

    it('音を鳴らさない（channel は LOW・sound を指定しない）', async () => {
      await presentCookingNotification('肉じゃが', '手順 1 / 5');

      const channel = (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls[0];
      expect(channel[0]).toBe('cooking-session');
      // **ここを DEFAULT 以上に上げると 1 手順ごとに鳴る。**
      // モックの AndroidImportance は実物と同じ値に揃えてある（__mocks__ 参照）
      expect(channel[1].importance).toBe(Notifications.AndroidImportance.LOW);

      const content = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0]
        .content;
      expect(content.sound).toBeUndefined();
      expect(content.sticky).toBe(true);
    });

    it('タップ判定に使う data.type を付ける', async () => {
      await presentCookingNotification('肉じゃが', '手順 1 / 5');
      const content = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0]
        .content;
      expect(content.data).toEqual({ type: 'cooking-resume' });
    });

    it('タップ受け口は cooking-resume だけに反応する', () => {
      const onTap = jest.fn();
      addCookingResumeTapListener(onTap);
      const handler = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock
        .calls[0][0];

      handler({ notification: { request: { content: { data: { type: 'low-stock' } } } } });
      expect(onTap).not.toHaveBeenCalled();

      // **presentCookingNotification が付ける type と一致していること。**
      // 片方だけ変えるとタップが無反応になる
      handler({ notification: { request: { content: { data: { type: 'cooking-resume' } } } } });
      expect(onTap).toHaveBeenCalledTimes(1);
    });

    it('同じ identifier を消す', async () => {
      await dismissCookingNotification();
      expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('cooking-session');
    });

    it('**権限を要求しない** — 未許可なら黙って出さない', async () => {
      // 権限の判定結果は**モジュール変数にキャッシュ**される（ensureNotificationPermission と共有）。
      // 同じファイルの先行テストが granted を焼き込むので、ここだけモジュールごと作り直す。
      // これをやらずに書くと「未許可でも通知が出る」誤った期待を固定してしまう（実際に一度落ちた）
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const freshNotifications = require('expo-notifications');
      freshNotifications.getPermissionsAsync.mockResolvedValue({
        status: 'undetermined',
        granted: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fresh = require('../notification.service');

      await fresh.presentCookingNotification('肉じゃが', '手順 1 / 5');

      // 調理開始の瞬間に権限ダイアログで割り込まない（実機検証で唐突さを確認した挙動）
      expect(freshNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
      expect(freshNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });
  });
});
