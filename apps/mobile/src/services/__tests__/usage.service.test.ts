let mockStore: Record<string, string> = {};
let mockPremium = false;

jest.mock('../app-meta.service', () => ({
  getAppMeta: jest.fn(async (key: string) => mockStore[key] ?? null),
  setAppMeta: jest.fn(async (key: string, value: string) => {
    mockStore[key] = value;
  }),
}));

jest.mock('../entitlement.service', () => ({
  isPremium: jest.fn(async () => mockPremium),
}));

import {
  currentMonthKey,
  deriveFreemiumStatus,
  FREE_MONTHLY_LIMIT,
  getFreemiumStatus,
  getMonthlyUsage,
  incrementMonthlyUsage,
  recordCloudInference,
  remainingFree,
} from '../usage.service';

describe('usage.service', () => {
  beforeEach(() => {
    mockStore = {};
    mockPremium = false;
  });

  describe('currentMonthKey', () => {
    it('formats year-month with a zero-padded month', () => {
      // Local-time constructors (the function uses the user's calendar month).
      expect(currentMonthKey(new Date(2026, 5, 28))).toBe('2026-06');
      expect(currentMonthKey(new Date(2026, 0, 1))).toBe('2026-01');
      expect(currentMonthKey(new Date(2026, 11, 31))).toBe('2026-12');
    });
  });

  describe('remainingFree', () => {
    it('never goes negative', () => {
      expect(remainingFree(0)).toBe(3);
      expect(remainingFree(2)).toBe(1);
      expect(remainingFree(3)).toBe(0);
      expect(remainingFree(5)).toBe(0);
    });
  });

  describe('deriveFreemiumStatus', () => {
    it('grants unlimited use to premium', () => {
      const status = deriveFreemiumStatus(true, 99);
      expect(status.isPremium).toBe(true);
      expect(status.canInfer).toBe(true);
      expect(status.remaining).toBe(Number.POSITIVE_INFINITY);
    });

    it('gates the free tier by the monthly limit', () => {
      expect(deriveFreemiumStatus(false, 0)).toMatchObject({ remaining: 3, canInfer: true });
      expect(deriveFreemiumStatus(false, 2)).toMatchObject({ remaining: 1, canInfer: true });
      expect(deriveFreemiumStatus(false, 3)).toMatchObject({ remaining: 0, canInfer: false });
    });
  });

  describe('monthly counter', () => {
    it('starts at zero and increments within a month', async () => {
      const date = new Date(2026, 5, 10);
      expect(await getMonthlyUsage(date)).toBe(0);
      expect(await incrementMonthlyUsage(date)).toBe(1);
      expect(await incrementMonthlyUsage(date)).toBe(2);
      expect(await getMonthlyUsage(date)).toBe(2);
    });

    it('auto-resets when the month changes', async () => {
      const june = new Date(2026, 5, 30);
      const july = new Date(2026, 6, 1);
      await incrementMonthlyUsage(june);
      await incrementMonthlyUsage(june);
      expect(await getMonthlyUsage(june)).toBe(2);
      expect(await getMonthlyUsage(july)).toBe(0);
    });
  });

  describe('getFreemiumStatus', () => {
    it('reflects the device-local count for free users', async () => {
      const status = await getFreemiumStatus();
      expect(status).toMatchObject({ isPremium: false, used: 0, remaining: FREE_MONTHLY_LIMIT });
    });

    it('reports unlimited for premium users', async () => {
      mockPremium = true;
      const status = await getFreemiumStatus();
      expect(status.isPremium).toBe(true);
      expect(status.canInfer).toBe(true);
    });
  });

  describe('recordCloudInference', () => {
    it('counts a use for free users', async () => {
      await recordCloudInference();
      expect(await getMonthlyUsage()).toBe(1);
    });

    it('does not count for premium users', async () => {
      mockPremium = true;
      await recordCloudInference();
      expect(await getMonthlyUsage()).toBe(0);
    });
  });
});
