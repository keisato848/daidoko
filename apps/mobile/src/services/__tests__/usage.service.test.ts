let mockStore: Record<string, string> = {};
let mockPremium = false;
let mockAdAvailable = false;
let mockByok = false;

jest.mock('../app-meta.service', () => ({
  getAppMeta: jest.fn(async (key: string) => mockStore[key] ?? null),
  setAppMeta: jest.fn(async (key: string, value: string) => {
    mockStore[key] = value;
  }),
}));

jest.mock('../entitlement.service', () => ({
  isPremium: jest.fn(async () => mockPremium),
}));

jest.mock('../ad-reward.service', () => ({
  isAdRewardAvailable: jest.fn(() => mockAdAvailable),
}));

jest.mock('../byok.service', () => ({
  hasUserApiKey: jest.fn(async () => mockByok),
}));

import {
  AD_BONUS_DAILY_LIMIT,
  currentDayKey,
  deriveFreemiumStatus,
  FREE_DAILY_LIMIT,
  getAdBonusGranted,
  getDailyUsage,
  getFreemiumStatus,
  grantAdBonus,
  incrementDailyUsage,
  recordCloudInference,
  remainingFree,
} from '../usage.service';

describe('usage.service', () => {
  beforeEach(() => {
    mockStore = {};
    mockPremium = false;
    mockAdAvailable = false;
    mockByok = false;
  });

  describe('currentDayKey', () => {
    it('formats year-month-day, zero-padded', () => {
      // Local-time constructors (the function uses the user's calendar day).
      expect(currentDayKey(new Date(2026, 5, 28))).toBe('2026-06-28');
      expect(currentDayKey(new Date(2026, 0, 1))).toBe('2026-01-01');
      expect(currentDayKey(new Date(2026, 11, 9))).toBe('2026-12-09');
    });
  });

  describe('remainingFree', () => {
    it('never goes negative', () => {
      expect(remainingFree(0)).toBe(1);
      expect(remainingFree(1)).toBe(0);
      expect(remainingFree(3)).toBe(0);
    });
  });

  describe('deriveFreemiumStatus', () => {
    it('grants unlimited use to premium', () => {
      const status = deriveFreemiumStatus(true, 99);
      expect(status.isPremium).toBe(true);
      expect(status.canInfer).toBe(true);
      expect(status.remaining).toBe(Number.POSITIVE_INFINITY);
    });

    it('gates the free tier by the daily limit', () => {
      expect(deriveFreemiumStatus(false, 0)).toMatchObject({ remaining: 1, canInfer: true });
      expect(deriveFreemiumStatus(false, 1)).toMatchObject({ remaining: 0, canInfer: false });
      expect(deriveFreemiumStatus(false, 2)).toMatchObject({ remaining: 0, canInfer: false });
    });
  });

  describe('daily counter', () => {
    it('starts at zero and increments within a day', async () => {
      const date = new Date(2026, 5, 10);
      expect(await getDailyUsage(date)).toBe(0);
      expect(await incrementDailyUsage(date)).toBe(1);
      expect(await incrementDailyUsage(date)).toBe(2);
      expect(await getDailyUsage(date)).toBe(2);
    });

    it('auto-resets when the day changes', async () => {
      const day1 = new Date(2026, 5, 30);
      const day2 = new Date(2026, 6, 1);
      await incrementDailyUsage(day1);
      expect(await getDailyUsage(day1)).toBe(1);
      expect(await getDailyUsage(day2)).toBe(0);
    });
  });

  describe('getFreemiumStatus', () => {
    it('reflects the device-local count for free users', async () => {
      const status = await getFreemiumStatus();
      expect(status).toMatchObject({ isPremium: false, used: 0, remaining: FREE_DAILY_LIMIT });
    });

    it('reports unlimited for premium users', async () => {
      mockPremium = true;
      const status = await getFreemiumStatus();
      expect(status.isPremium).toBe(true);
      expect(status.canInfer).toBe(true);
    });

    it('reports unlimited (BYOK) when a user key is set', async () => {
      mockByok = true;
      const status = await getFreemiumStatus();
      expect(status.isByok).toBe(true);
      expect(status.canInfer).toBe(true);
    });
  });

  describe('recordCloudInference', () => {
    it('counts a use for free users', async () => {
      await recordCloudInference();
      expect(await getDailyUsage()).toBe(1);
    });

    it('does not count for premium users', async () => {
      mockPremium = true;
      await recordCloudInference();
      expect(await getDailyUsage()).toBe(0);
    });

    it('does not count for BYOK users', async () => {
      mockByok = true;
      await recordCloudInference();
      expect(await getDailyUsage()).toBe(0);
    });
  });

  describe('ad bonus', () => {
    it('grants extra uses up to the daily cap', async () => {
      const d = new Date(2026, 5, 10);
      expect(await getAdBonusGranted(d)).toBe(0);
      expect(await grantAdBonus(d)).toBe(1);
      expect(await grantAdBonus(d)).toBe(2);
      expect(await grantAdBonus(d)).toBe(AD_BONUS_DAILY_LIMIT);
      // further grants are capped
      expect(await grantAdBonus(d)).toBe(AD_BONUS_DAILY_LIMIT);
    });

    it('raises the effective allowance via deriveFreemiumStatus', () => {
      // used 1 (base spent) but 1 ad bonus granted → 1 use left
      expect(deriveFreemiumStatus(false, 1, 1, true)).toMatchObject({
        remaining: 1,
        canInfer: true,
      });
    });

    it('offers an ad only when out of uses, ads available, cap not reached', () => {
      expect(deriveFreemiumStatus(false, 1, 0, true).canWatchAdForMore).toBe(true);
      // ads unavailable → no offer
      expect(deriveFreemiumStatus(false, 1, 0, false).canWatchAdForMore).toBe(false);
      // still has a use left → no offer yet
      expect(deriveFreemiumStatus(false, 0, 0, true).canWatchAdForMore).toBe(false);
      // bonus cap reached → no offer
      expect(
        deriveFreemiumStatus(false, 1 + AD_BONUS_DAILY_LIMIT, AD_BONUS_DAILY_LIMIT, true)
          .canWatchAdForMore,
      ).toBe(false);
    });

    it('never offers ads to premium users', () => {
      expect(deriveFreemiumStatus(true, 0, 0, true).canWatchAdForMore).toBe(false);
    });

    it('treats BYOK as unlimited (no ads, no quota)', () => {
      const status = deriveFreemiumStatus(false, 5, 0, true, true);
      expect(status).toMatchObject({
        isByok: true,
        isPremium: false,
        canInfer: true,
        canWatchAdForMore: false,
        remaining: Number.POSITIVE_INFINITY,
      });
    });

    it('getFreemiumStatus surfaces the ad option when available and exhausted', async () => {
      mockAdAvailable = true;
      await recordCloudInference(); // use the 1 free daily
      const status = await getFreemiumStatus();
      expect(status.canInfer).toBe(false);
      expect(status.canWatchAdForMore).toBe(true);
    });
  });
});
