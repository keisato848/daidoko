/**
 * Freemium usage service — device-local quota for AI features.
 *
 * **AI 写真レシピと AI 献立並べ替え（M2・設計 §10.10）で共通の「全体枠」**
 * （§10.8「枠を機能ごとに分けると利用者が数え分けられない」・§10.10.7-1 決定）。
 * どちらの機能を使っても同じカウンタを 1 消費する。
 *
 * 無料枠は**月あたり FREE_MONTHLY_LIMIT 回**（既定 5・端末ローカル時刻の暦月でリセット。
 * 2026-08-28 に「生涯 1 回」から変更 — ユーザー決定。設計 §10.10.0/§10.10.7-1）。
 * 使い切ったら、リワード広告を見るたびに 1 回ぶんのトークンが貯まる。トークンは無期限。
 *
 * **広告視聴の回数に上限は無い**（2026-08-14 に AD_BONUS_DAILY_LIMIT=3 を撤廃 —
 * ユーザー判断「無料でも使い続けられるように」）。1 日 3 本の上限があった頃は、
 * 4 本目を見ようとした無料ユーザーが BYOK 案内しかないペイウォールに飛ばされ、
 * その日は事実上使えなくなっていた。全体のコスト上限はサーバーの global cap
 * (`apps/server/src/lib/rate-limit.ts`) が担保するので、端末側で速度制限をかける
 * 必要はない。Premium (RevenueCat) bypasses the quota. See docs/フリーミアム設計.md.
 *
 * 既存ユーザーへの移行: 旧・生涯キー（`ai_photo_recipe_free_lifetime_used`）は
 * 読まない。月次キーは月が変わるたびに 0 から始まるので、移行という概念自体が無い
 * （旧キーを引き継いでも今月ぶんの消費数としては意味を持たない）。
 */
import { FREE_DAILY_LIMIT_CONFIG } from '../config';
import { isAdRewardAvailable } from './ad-reward.service';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { hasUserApiKey } from './byok.service';
import { isPremium } from './entitlement.service';

/**
 * 無料の AI 利用の**月あたり**回数（build-time configurable, default 5）。
 * env は `EXPO_PUBLIC_FREE_DAILY_LIMIT`（歴史的な名前のまま — 「1 日あたり」だった
 * 頃の名残で、2026-08-12 に生涯 1 回へ、2026-08-28 に月 N 回へ意味が変わっている。
 * **0 のビルドは常時ペイウォール／広告フローの E2E 検証に使う**ので、env 名も
 * 「0 = 常時広告」の挙動も変えない）。
 */
export const FREE_MONTHLY_LIMIT = FREE_DAILY_LIMIT_CONFIG;

const USAGE_KEY_PREFIX = 'ai_photo_recipe_usage:';
/** 月次の無料枠消費数のキー接頭辞。`YYYY-MM`（端末ローカル時刻）を続けて使う。 */
const MONTHLY_FREE_KEY_PREFIX = 'ai_photo_recipe_free_used:';
const TOKEN_BALANCE_KEY = 'ai_photo_recipe_token_balance';

export interface FreemiumStatus {
  isPremium: boolean;
  /** Unlimited via the user's own Gemini key (BYOK). */
  isByok: boolean;
  /** Successful cloud inferences used today (0 for premium display). */
  used: number;
  /** Effective allowance today (base + banked tokens); Infinity for premium. */
  limit: number;
  /** Remaining uses today; Infinity for premium. */
  remaining: number;
  canInfer: boolean;
  /** Offer a rewarded ad: out of uses and an ad can be shown. No per-day watch cap. */
  canWatchAdForMore: boolean;
  /** Ad-earned tokens banked and not yet spent (persists across days). */
  tokenBalance: number;
}

/** Calendar-day key, e.g. "2026-06-28". */
export function currentDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Calendar-month key, e.g. "2026-06" (local time — the free quota resets by device calendar). */
export function currentMonthKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function remainingFree(used: number, limit: number = FREE_MONTHLY_LIMIT): number {
  return Math.max(0, limit - used);
}

/** Pure mapping from (premium, used, banked tokens, ad state) to gate status. */
export function deriveFreemiumStatus(
  premium: boolean,
  used: number,
  tokenBalance = 0,
  adAvailable = false,
  byok = false,
  baseLimit: number = FREE_MONTHLY_LIMIT,
): FreemiumStatus {
  if (premium || byok) {
    return {
      isPremium: premium,
      isByok: byok && !premium,
      used: 0,
      limit: Number.POSITIVE_INFINITY,
      remaining: Number.POSITIVE_INFINITY,
      canInfer: true,
      canWatchAdForMore: false,
      tokenBalance: 0,
    };
  }
  const balance = Math.max(0, tokenBalance);
  const limit = baseLimit + balance;
  const remaining = Math.max(0, baseLimit - used) + balance;
  return {
    isPremium: false,
    isByok: false,
    used,
    limit,
    remaining,
    canInfer: remaining > 0,
    canWatchAdForMore: adAvailable && remaining === 0,
    tokenBalance: balance,
  };
}

async function readCount(key: string): Promise<number> {
  const raw = await getAppMeta(key);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export async function getDailyUsage(date: Date = new Date()): Promise<number> {
  return readCount(USAGE_KEY_PREFIX + currentDayKey(date));
}

export async function incrementDailyUsage(date: Date = new Date()): Promise<number> {
  const next = (await getDailyUsage(date)) + 1;
  await setAppMeta(USAGE_KEY_PREFIX + currentDayKey(date), String(next));
  return next;
}

/** 今月、無料枠をいくつ使ったか（端末ローカル時刻の暦月で区切る）。 */
export async function getMonthlyFreeUsed(date: Date = new Date()): Promise<number> {
  return readCount(MONTHLY_FREE_KEY_PREFIX + currentMonthKey(date));
}

async function incrementMonthlyFreeUsed(date: Date = new Date()): Promise<void> {
  const next = (await getMonthlyFreeUsed(date)) + 1;
  await setAppMeta(MONTHLY_FREE_KEY_PREFIX + currentMonthKey(date), String(next));
}

/** Ad-earned tokens banked and not yet spent. Persists indefinitely (no date key). */
export async function getTokenBalance(): Promise<number> {
  return readCount(TOKEN_BALANCE_KEY);
}

async function setTokenBalance(value: number): Promise<void> {
  await setAppMeta(TOKEN_BALANCE_KEY, String(Math.max(0, value)));
}

/**
 * Watch a rewarded ad to earn one banked token (persists indefinitely).
 * **Ungated** — every watch banks a token, however many times a day.
 * Returns the new token balance.
 */
export async function grantAdBonus(): Promise<number> {
  const next = (await getTokenBalance()) + 1;
  await setTokenBalance(next);
  return next;
}

/** Spend one banked token (floors at 0). Returns the new balance. */
export async function spendToken(): Promise<number> {
  const balance = await getTokenBalance();
  if (balance <= 0) return 0;
  const next = balance - 1;
  await setTokenBalance(next);
  return next;
}

/** Combined premium + quota + token status for the gate / UI. */
export async function getFreemiumStatus(date: Date = new Date()): Promise<FreemiumStatus> {
  const [premium, used, tokenBalance, byok] = await Promise.all([
    isPremium(),
    getMonthlyFreeUsed(date),
    getTokenBalance(),
    hasUserApiKey(),
  ]);
  return deriveFreemiumStatus(premium, used, tokenBalance, isAdRewardAvailable(), byok);
}

/**
 * Count one successful cloud inference against the quota: spends this month's
 * free allowance first, then a banked token if the free allowance is used up.
 * No-op for premium and BYOK users (BYOK uses the user's own key/quota).
 * Call only when the AI (our managed server) actually returned a draft —
 * for photo recipes **and** for AI menu-arrange (M2), which share this counter
 * (設計 §10.8「枠を機能ごとに分けると利用者が数え分けられない」)。
 */
export async function recordCloudInference(date: Date = new Date()): Promise<void> {
  if (await isPremium()) return;
  if (await hasUserApiKey()) return;
  const used = await getMonthlyFreeUsed(date);
  if (used < FREE_MONTHLY_LIMIT) {
    await incrementMonthlyFreeUsed(date);
  } else {
    await spendToken();
  }
}

/**
 * 今この端末で AI を実行するとき、無料の月次枠から出るのか（トークン残高から）
 * 出るのかを**実行前に**判定する。サーバー `POST /infer/menu` の
 * `x-quota-source` ヘッダに使う（設計 §10.10.1・§10.10.7-2）。
 *
 * - premium → `'premium'`（サーバーは月次枠チェックを飛ばす）
 * - 月次無料枠を使い切っている（＝この呼び出しはトークン由来） → `'token'`
 * - それ以外（月次無料枠がまだ残っている・BYOK） → `undefined`
 *   （BYOK はサーバーを叩かないので呼び出し側でヘッダ自体を付けない。
 *   月次枠が残っているときも付けない —— サーバー側の月次枠チェックに乗せる）
 */
export async function resolveQuotaSource(
  date: Date = new Date(),
): Promise<'token' | 'premium' | undefined> {
  if (await isPremium()) return 'premium';
  const used = await getMonthlyFreeUsed(date);
  return used >= FREE_MONTHLY_LIMIT ? 'token' : undefined;
}
