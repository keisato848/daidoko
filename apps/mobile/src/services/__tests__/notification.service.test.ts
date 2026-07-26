jest.mock('../../db/client', () => ({ isNativePlatform: true }));

import * as Notifications from 'expo-notifications';

import {
  addLowStockTapListener,
  cancelTimerNotification,
  consumeLowStockLaunchTap,
  ensureNotificationPermission,
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
});
