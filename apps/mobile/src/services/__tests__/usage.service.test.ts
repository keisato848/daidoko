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
  currentDayKey,
  currentMonthKey,
  deriveFreemiumStatus,
  FREE_MONTHLY_LIMIT,
  getDailyUsage,
  getMonthlyFreeUsed,
  getFreemiumStatus,
  getTokenBalance,
  grantAdBonus,
  incrementDailyUsage,
  recordCloudInference,
  remainingFree,
  resolveQuotaSource,
  spendToken,
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

  describe('currentMonthKey', () => {
    it('formats year-month, zero-padded', () => {
      expect(currentMonthKey(new Date(2026, 5, 28))).toBe('2026-06');
      expect(currentMonthKey(new Date(2026, 0, 1))).toBe('2026-01');
      expect(currentMonthKey(new Date(2026, 11, 9))).toBe('2026-12');
    });
  });

  describe('remainingFree', () => {
    it('never goes negative', () => {
      expect(remainingFree(0)).toBe(FREE_MONTHLY_LIMIT);
      expect(remainingFree(FREE_MONTHLY_LIMIT)).toBe(0);
      expect(remainingFree(FREE_MONTHLY_LIMIT + 2)).toBe(0);
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
      expect(deriveFreemiumStatus(false, 0)).toMatchObject({
        remaining: FREE_MONTHLY_LIMIT,
        canInfer: true,
      });
      expect(deriveFreemiumStatus(false, FREE_MONTHLY_LIMIT)).toMatchObject({
        remaining: 0,
        canInfer: false,
      });
      expect(deriveFreemiumStatus(false, FREE_MONTHLY_LIMIT + 1)).toMatchObject({
        remaining: 0,
        canInfer: false,
      });
    });

    it('supports a zero base limit (ads become the only free path)', () => {
      // EXPO_PUBLIC_FREE_DAILY_LIMIT=0 のビルド（広告フロー検証にも使う）
      const status = deriveFreemiumStatus(false, 0, 0, true, false, 0);
      expect(status).toMatchObject({ remaining: 0, canInfer: false, canWatchAdForMore: true });
      const withToken = deriveFreemiumStatus(false, 0, 1, true, false, 0);
      expect(withToken).toMatchObject({ remaining: 1, canInfer: true });
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

  describe('monthly free counter', () => {
    it('starts at zero and increments within a month', async () => {
      const early = new Date(2026, 7, 1);
      const late = new Date(2026, 7, 28);
      expect(await getMonthlyFreeUsed(early)).toBe(0);
      await recordCloudInference(early);
      await recordCloudInference(late); // 同じ暦月なので同じキーへ積む
      expect(await getMonthlyFreeUsed(early)).toBe(2);
      expect(await getMonthlyFreeUsed(late)).toBe(2);
    });

    it('月替わりで無料枠がリセットされる（生涯 1 回からの変更点）', async () => {
      const monthA = new Date(2026, 7, 31);
      const monthB = new Date(2026, 8, 1);
      // 8 月ぶんを使い切る
      for (let i = 0; i < FREE_MONTHLY_LIMIT; i += 1) {
        await recordCloudInference(monthA);
      }
      expect(await getMonthlyFreeUsed(monthA)).toBe(FREE_MONTHLY_LIMIT);
      expect((await getFreemiumStatus(monthA)).canInfer).toBe(false);

      // 9 月になれば別キー = 0 から
      expect(await getMonthlyFreeUsed(monthB)).toBe(0);
      expect((await getFreemiumStatus(monthB)).canInfer).toBe(true);
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
      expect(await getMonthlyFreeUsed()).toBe(1);
    });

    it('does not count for premium users', async () => {
      mockPremium = true;
      await recordCloudInference();
      expect(await getMonthlyFreeUsed()).toBe(0);
    });

    it('does not count for BYOK users', async () => {
      mockByok = true;
      await recordCloudInference();
      expect(await getMonthlyFreeUsed()).toBe(0);
    });

    it('spends a banked token once the monthly free allowance is used up', async () => {
      for (let i = 0; i < FREE_MONTHLY_LIMIT; i += 1) {
        await recordCloudInference(); // 月次無料枠を使い切る
      }
      expect(await getMonthlyFreeUsed()).toBe(FREE_MONTHLY_LIMIT);
      await grantAdBonus(); // bank 1 token
      expect(await getTokenBalance()).toBe(1);

      await recordCloudInference(); // free allowance already used → spends the token
      expect(await getMonthlyFreeUsed()).toBe(FREE_MONTHLY_LIMIT); // monthly counter untouched
      expect(await getTokenBalance()).toBe(0);
    });

    it('無料枠は同じ月の中では復活しない', async () => {
      const date = new Date(2026, 7, 5);
      for (let i = 0; i < FREE_MONTHLY_LIMIT; i += 1) {
        await recordCloudInference(date);
      }
      const status = await getFreemiumStatus(date);
      expect(status.remaining).toBe(0);
      expect(status.canInfer).toBe(false);
    });
  });

  describe('resolveQuotaSource', () => {
    it('returns premium for premium users', async () => {
      mockPremium = true;
      expect(await resolveQuotaSource()).toBe('premium');
    });

    it('returns undefined while the monthly free allowance still has room', async () => {
      expect(await resolveQuotaSource()).toBeUndefined();
    });

    it('returns token once the monthly free allowance is exhausted', async () => {
      const date = new Date(2026, 7, 10);
      for (let i = 0; i < FREE_MONTHLY_LIMIT; i += 1) {
        await recordCloudInference(date);
      }
      expect(await resolveQuotaSource(date)).toBe('token');
    });

    it('is undefined again the moment the calendar month rolls over', async () => {
      const monthA = new Date(2026, 7, 31);
      const monthB = new Date(2026, 8, 1);
      for (let i = 0; i < FREE_MONTHLY_LIMIT; i += 1) {
        await recordCloudInference(monthA);
      }
      expect(await resolveQuotaSource(monthA)).toBe('token');
      expect(await resolveQuotaSource(monthB)).toBeUndefined();
    });
  });

  describe('token banking', () => {
    // 1 日 3 本の獲得上限は 2026-08-14 に撤廃(#173)。無料ユーザーが「広告を見れば
    // 使い続けられる」状態を守るのがこのテストの目的なので、回数を増やしても止まらないこと。
    it('grants a token per watch, with no daily cap', async () => {
      expect(await getTokenBalance()).toBe(0);
      for (let i = 1; i <= 10; i += 1) {
        expect(await grantAdBonus()).toBe(i);
      }
    });

    it('banks tokens indefinitely — balance survives a day change', async () => {
      await grantAdBonus();
      await grantAdBonus();
      expect(await getTokenBalance()).toBe(2);

      // 日付キーを持たないので、暦日をまたいでも残高はそのまま
      expect(await getTokenBalance()).toBe(2);
      expect(await grantAdBonus()).toBe(3);
    });

    it('spendToken floors at zero', async () => {
      expect(await spendToken()).toBe(0);
      await grantAdBonus();
      expect(await spendToken()).toBe(0);
    });

    // 新規インストール直後に配られるトークンは無い。無料枠だけで始まる
    // （リリース記念ボーナスの +3 は 2026-08-13 に撤去 — 初回が 4 回に見えていた）
    it('新規インストールではトークンを持たない', async () => {
      expect(await getTokenBalance()).toBe(0);
    });

    it('raises the effective allowance via deriveFreemiumStatus', () => {
      // base limit 1, used 1 (base spent) but 1 token banked → 1 use left
      expect(deriveFreemiumStatus(false, 1, 1, true, false, 1)).toMatchObject({
        remaining: 1,
        canInfer: true,
      });
    });

    it('offers an ad whenever out of uses and an ad can be shown', () => {
      expect(deriveFreemiumStatus(false, FREE_MONTHLY_LIMIT, 0, true).canWatchAdForMore).toBe(true);
      // ads unavailable → no offer
      expect(deriveFreemiumStatus(false, FREE_MONTHLY_LIMIT, 0, false).canWatchAdForMore).toBe(
        false,
      );
      // still has a use left → no offer yet
      expect(deriveFreemiumStatus(false, 0, 0, true).canWatchAdForMore).toBe(false);
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
      for (let i = 0; i < FREE_MONTHLY_LIMIT; i += 1) {
        await recordCloudInference(); // 月次無料枠を使い切る
      }
      const status = await getFreemiumStatus();
      expect(status.canInfer).toBe(false);
      expect(status.canWatchAdForMore).toBe(true);
    });

    // #173 の回帰テスト。以前は 1 日 3 本で canWatchAdForMore が false になり、
    // 4 本目を見ようとした無料ユーザーがペイウォールに詰んでいた。
    it('無料ユーザーは同じ月の中で何度でも「広告→1回」を繰り返せる', async () => {
      mockAdAvailable = true;
      for (let i = 0; i < FREE_MONTHLY_LIMIT; i += 1) {
        await recordCloudInference(); // 月次無料枠を使い切る
      }

      for (let i = 0; i < 8; i += 1) {
        const exhausted = await getFreemiumStatus();
        expect(exhausted.canInfer).toBe(false);
        expect(exhausted.canWatchAdForMore).toBe(true); // 何本目でも広告を持ちかけられる

        await grantAdBonus(); // 広告を見た
        expect((await getFreemiumStatus()).canInfer).toBe(true);
        await recordCloudInference(); // 使う → またトークン 0
      }

      expect(await getTokenBalance()).toBe(0);
    });
  });
});
