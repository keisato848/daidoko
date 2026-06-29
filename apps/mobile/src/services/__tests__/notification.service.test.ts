jest.mock('../../db/client', () => ({ isNativePlatform: true }));

import * as Notifications from 'expo-notifications';

import {
  cancelTimerNotification,
  ensureNotificationPermission,
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
});
