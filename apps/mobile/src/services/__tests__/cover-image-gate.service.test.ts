/**
 * cover-image の別勘定ゲート（月 3 枚・広告 1 枚・BYOK・月替わりリセット）。
 * 既存トークン（usage.service）とは完全に別の器であること自体もここで守る。
 */
let mockStore: Record<string, string> = {};
let mockPremium = false;
let mockAdAvailable = false;
let mockByok = false;
let mockAdRewarded = true;
const mockConfirm = jest.fn(async () => true);

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
  getAdRewardProvider: jest.fn(() => ({
    showRewardedAd: jest.fn(async () => ({ rewarded: mockAdRewarded })),
  })),
}));

jest.mock('../byok.service', () => ({
  hasUserApiKey: jest.fn(async () => mockByok),
}));

jest.mock('../dialog.service', () => ({
  dialog: { confirm: (...args: unknown[]) => mockConfirm(...args) },
}));

import {
  decideCoverImageGate,
  deriveCoverImageGateStatus,
  ensureCoverImageCredit,
  FREE_MONTHLY_COVER_LIMIT,
  getCoverImageGateStatus,
  getMonthlyCoverUsed,
  PREMIUM_MONTHLY_COVER_LIMIT,
  recordCoverImageUse,
} from '../cover-image-gate.service';
import { getMonthlyFreeUsed } from '../usage.service';

describe('cover-image-gate.service', () => {
  beforeEach(() => {
    mockStore = {};
    mockPremium = false;
    mockAdAvailable = false;
    mockByok = false;
    mockAdRewarded = true;
    mockConfirm.mockClear();
    mockConfirm.mockResolvedValue(true);
  });

  describe('deriveCoverImageGateStatus', () => {
    it('無料・枠内なら生成できる', () => {
      const status = deriveCoverImageGateStatus(false, false, 0);
      expect(status.canGenerate).toBe(true);
      expect(status.limit).toBe(FREE_MONTHLY_COVER_LIMIT);
      expect(status.remaining).toBe(FREE_MONTHLY_COVER_LIMIT);
    });

    it('無料・月 3 枚を使い切ると生成できない', () => {
      const status = deriveCoverImageGateStatus(false, false, FREE_MONTHLY_COVER_LIMIT);
      expect(status.canGenerate).toBe(false);
      expect(status.remaining).toBe(0);
    });

    it('無料・枠切れ＋広告を出せるなら offer-ad の材料が揃う', () => {
      const status = deriveCoverImageGateStatus(false, false, FREE_MONTHLY_COVER_LIMIT, true);
      expect(status.canWatchAdForMore).toBe(true);
    });

    it('プレミアムは月 10〜15 枚の枠を使う（無料の 3 枚とは別の上限）', () => {
      const status = deriveCoverImageGateStatus(true, false, 0);
      expect(status.limit).toBe(PREMIUM_MONTHLY_COVER_LIMIT);
      expect(status.canGenerate).toBe(true);
    });

    it('プレミアムが枠切れでも広告は出さない（§11「広告なし」）', () => {
      const status = deriveCoverImageGateStatus(true, false, PREMIUM_MONTHLY_COVER_LIMIT, true);
      expect(status.canGenerate).toBe(false);
      expect(status.canWatchAdForMore).toBe(false);
    });

    it('BYOK は無制限（月次カウントを見ない）', () => {
      const status = deriveCoverImageGateStatus(false, true, 999);
      expect(status.canGenerate).toBe(true);
      expect(status.limit).toBe(Number.POSITIVE_INFINITY);
      expect(status.remaining).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe('decideCoverImageGate', () => {
    it('生成できるならそのまま実行', () => {
      expect(decideCoverImageGate({ canGenerate: true, canWatchAdForMore: false })).toBe('ready');
    });

    it('枠切れでも広告を出せるなら offer-ad', () => {
      expect(decideCoverImageGate({ canGenerate: false, canWatchAdForMore: true })).toBe(
        'offer-ad',
      );
    });

    it('枠切れ＋広告も出せないときだけ paywall', () => {
      expect(decideCoverImageGate({ canGenerate: false, canWatchAdForMore: false })).toBe(
        'paywall',
      );
    });
  });

  describe('recordCoverImageUse / getMonthlyCoverUsed', () => {
    it('成功時のみ加算され、月替わりで別カウンタになる', async () => {
      const august = new Date('2026-08-15T00:00:00.000Z');
      const september = new Date('2026-09-01T00:00:00.000Z');

      expect(await getMonthlyCoverUsed(august)).toBe(0);
      await recordCoverImageUse(august);
      await recordCoverImageUse(august);
      expect(await getMonthlyCoverUsed(august)).toBe(2);

      // 月が変わればまた 0 から（app_meta のキーに YYYY-MM が入っているため）
      expect(await getMonthlyCoverUsed(september)).toBe(0);
    });

    it('別勘定であること: usage.service のトークン残高キーとは無関係', async () => {
      const date = new Date('2026-08-20T00:00:00.000Z');

      await recordCoverImageUse(date);
      expect(await getMonthlyCoverUsed(date)).toBe(1);
      // cover-image の消費が usage.service の月次無料枠（写真レシピ/献立）を減らさない
      // — usage.service 側の app-meta.service モックも同じ mockStore を見るので、
      // ここに `ai_photo_recipe_free_used:` の値が無いことがそのまま確認になる
      expect(await getMonthlyFreeUsed(date)).toBe(0);
    });
  });

  describe('getCoverImageGateStatus', () => {
    it('app-meta / entitlement / byok / ad-reward を合成する', async () => {
      mockPremium = true;
      const status = await getCoverImageGateStatus(new Date('2026-08-20T00:00:00.000Z'));
      expect(status.isPremium).toBe(true);
      expect(status.limit).toBe(PREMIUM_MONTHLY_COVER_LIMIT);
    });
  });

  describe('ensureCoverImageCredit', () => {
    it('枠が残っていれば確認ダイアログを出さずに ready', async () => {
      const result = await ensureCoverImageCredit();
      expect(result).toEqual({ result: 'ready', consumedAd: false });
      expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('枠切れ＋広告視聴に成功したら ready・consumedAd=true（月次枠は減らさない印）', async () => {
      const date = new Date('2026-08-20T00:00:00.000Z');
      for (let i = 0; i < FREE_MONTHLY_COVER_LIMIT; i += 1) await recordCoverImageUse(date);
      mockAdAvailable = true;
      mockAdRewarded = true;

      jest.useFakeTimers().setSystemTime(date);
      try {
        const result = await ensureCoverImageCredit();
        expect(result).toEqual({ result: 'ready', consumedAd: true });
      } finally {
        jest.useRealTimers();
      }
    });

    it('広告を見終わらなかった（rewarded=false）なら cancelled', async () => {
      mockAdAvailable = true;
      mockAdRewarded = false;
      const date = new Date('2026-08-20T00:00:00.000Z');
      for (let i = 0; i < FREE_MONTHLY_COVER_LIMIT; i += 1) await recordCoverImageUse(date);

      jest.useFakeTimers().setSystemTime(date);
      try {
        const result = await ensureCoverImageCredit();
        expect(result).toEqual({ result: 'cancelled', consumedAd: false });
      } finally {
        jest.useRealTimers();
      }
    });

    it('確認ダイアログでキャンセルしたら cancelled（広告は出さない）', async () => {
      mockAdAvailable = true;
      mockConfirm.mockResolvedValue(false);
      const date = new Date('2026-08-20T00:00:00.000Z');
      for (let i = 0; i < FREE_MONTHLY_COVER_LIMIT; i += 1) await recordCoverImageUse(date);

      jest.useFakeTimers().setSystemTime(date);
      try {
        const result = await ensureCoverImageCredit();
        expect(result).toEqual({ result: 'cancelled', consumedAd: false });
      } finally {
        jest.useRealTimers();
      }
    });

    it('枠切れ＋広告も出せないなら paywall', async () => {
      const date = new Date('2026-08-20T00:00:00.000Z');
      for (let i = 0; i < FREE_MONTHLY_COVER_LIMIT; i += 1) await recordCoverImageUse(date);
      mockAdAvailable = false;

      jest.useFakeTimers().setSystemTime(date);
      try {
        const result = await ensureCoverImageCredit();
        expect(result).toEqual({ result: 'paywall', consumedAd: false });
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
