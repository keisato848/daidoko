import {
  MENU_AUTO_DEFAULT_DAYS,
  MENU_AUTO_DEFAULT_NOTIFY_TIME,
  formatMenuAutoNotifyTime,
  isValidMenuAutoDays,
  parseMenuAutoNotifyTime,
  secondsUntilNextMenuNotifyTime,
} from '../menuAuto';

describe('isValidMenuAutoDays', () => {
  it('accepts the 2..7 range', () => {
    expect(isValidMenuAutoDays(2)).toBe(true);
    expect(isValidMenuAutoDays(7)).toBe(true);
    expect(isValidMenuAutoDays(MENU_AUTO_DEFAULT_DAYS)).toBe(true);
  });

  it('rejects out-of-range or non-integer values', () => {
    expect(isValidMenuAutoDays(1)).toBe(false);
    expect(isValidMenuAutoDays(8)).toBe(false);
    expect(isValidMenuAutoDays(3.5)).toBe(false);
  });
});

describe('formatMenuAutoNotifyTime / parseMenuAutoNotifyTime', () => {
  it('round-trips', () => {
    const time = { hour: 7, minute: 30 };
    expect(parseMenuAutoNotifyTime(formatMenuAutoNotifyTime(time))).toEqual(time);
  });

  it('rejects garbage and out-of-range values', () => {
    expect(parseMenuAutoNotifyTime('')).toBeNull();
    expect(parseMenuAutoNotifyTime('abc')).toBeNull();
    expect(parseMenuAutoNotifyTime('25:00')).toBeNull();
    expect(parseMenuAutoNotifyTime('7:60')).toBeNull();
  });
});

describe('secondsUntilNextMenuNotifyTime', () => {
  it('counts seconds to later today', () => {
    const now = new Date(2026, 7, 26, 6, 0, 0);
    expect(secondsUntilNextMenuNotifyTime(now, { hour: 7, minute: 0 })).toBe(3600);
  });

  it('rolls over to tomorrow once the time has passed today (day-crossing)', () => {
    const now = new Date(2026, 7, 26, 8, 0, 0);
    // 26日 8:00 → 27日 7:00 = 23時間
    expect(secondsUntilNextMenuNotifyTime(now, { hour: 7, minute: 0 })).toBe(23 * 3600);
  });

  it('treats an exact match as already passed (always schedules a future notification)', () => {
    const now = new Date(2026, 7, 26, 7, 0, 0);
    expect(secondsUntilNextMenuNotifyTime(now, { hour: 7, minute: 0 })).toBe(24 * 3600);
  });

  it('defaults to 7:00', () => {
    const now = new Date(2026, 7, 26, 6, 0, 0);
    expect(secondsUntilNextMenuNotifyTime(now)).toBe(3600);
    expect(MENU_AUTO_DEFAULT_NOTIFY_TIME).toEqual({ hour: 7, minute: 0 });
  });
});
