/**
 * App Open ad service — フォアグラウンド復帰時にアプリ起動広告を出す。
 * 「使い勝手を著しく損なわない」ためのガードが本体で、以下を全部満たした
 * ときだけ表示する（docs/フリーミアム設計.md §7）:
 *
 *   - Android の広告有効ビルド（EXPO_PUBLIC_ADMOB_ENABLED）でプレミアムでない
 *   - 写真の撮影/選択からの復帰ではない（カメラ往復で必ず background になるため）
 *   - 調理中でない（タイマーが idle 以外 or 調理・カメラ系の画面を開いている）
 *   - 60 秒以上アプリを離れていた（アプリ切替の往復では出さない）
 *   - 初回起動から 24 時間の猶予期間を過ぎている
 *   - 前回表示から 6 時間以上経過（≒ 1 日最大 2〜3 回）
 *
 * 状態は app_meta に永続化（再起動でも頻度キャップが維持される）。
 * 表示はベストエフォート — どこかで失敗しても静かに何もしない。
 */
import { Platform } from 'react-native';

import { AdMobAppOpenAdProvider } from './app-open-ad.admob';
import type { AppOpenAdProvider } from './app-open-ad.types';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { isPremium } from './entitlement.service';
import { ADMOB_APP_OPEN_UNIT_ID, ADMOB_ENABLED } from '../config';
import { useTimerStore } from '../stores/timer.store';

export const APP_OPEN_AD_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
export const APP_OPEN_AD_MIN_BACKGROUND_MS = 60 * 1000; // 60s
export const APP_OPEN_AD_FIRST_GRACE_MS = 24 * 60 * 60 * 1000; // 24h

const LAST_SHOWN_AT_KEY = 'app_open_ad_last_shown_at';
const FIRST_ELIGIBLE_AT_KEY = 'app_open_ad_first_eligible_at';

/** 調理・撮影の文脈で開く画面 — 復帰広告を出さない。 */
const SENSITIVE_ROUTE_SEGMENTS = [
  '/cook',
  '/receipt',
  '/import-photo',
  '/import-ocr',
  '/consume-meal',
  '/scan-barcode',
];

export type TimerGateStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface AppOpenAdGateInput {
  enabled: boolean;
  premium: boolean;
  photoCaptureInFlight: boolean;
  timerStatus: TimerGateStatus;
  pathname: string;
  /** epoch ms of the background transition; null = cold start (no transition seen) */
  backgroundedAt: number | null;
  lastShownAt: number | null;
  firstEligibleAt: number | null;
  now: number;
}

export type AppOpenAdGateReason =
  | 'show'
  | 'disabled'
  | 'premium'
  | 'photo-capture'
  | 'cooking-timer'
  | 'sensitive-screen'
  | 'cold-start'
  | 'short-absence'
  | 'grace-unset'
  | 'grace-period'
  | 'frequency-cap';

/** 表示可否の純粋判定（テスト対象）。 */
export function evaluateAppOpenAdGate(input: AppOpenAdGateInput): AppOpenAdGateReason {
  if (!input.enabled) return 'disabled';
  if (input.premium) return 'premium';
  if (input.photoCaptureInFlight) return 'photo-capture';
  if (input.timerStatus !== 'idle') return 'cooking-timer';
  if (SENSITIVE_ROUTE_SEGMENTS.some((seg) => input.pathname.includes(seg))) {
    return 'sensitive-screen';
  }
  if (input.backgroundedAt === null) return 'cold-start';
  if (input.now - input.backgroundedAt < APP_OPEN_AD_MIN_BACKGROUND_MS) return 'short-absence';
  if (input.firstEligibleAt === null) return 'grace-unset';
  if (input.now < input.firstEligibleAt) return 'grace-period';
  if (input.lastShownAt !== null && input.now - input.lastShownAt < APP_OPEN_AD_MIN_INTERVAL_MS) {
    return 'frequency-cap';
  }
  return 'show';
}

// ── 実行時状態 ────────────────────────────────────────────────────────────────

// ユニット ID 未設定なら完全オフ（本番ビルドにテストユニットが紛れ込む事故を防ぐ。
// 実機検証ではテスト ID を EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID に明示的に渡す）。
const isEnabled = (): boolean =>
  Platform.OS === 'android' && ADMOB_ENABLED && ADMOB_APP_OPEN_UNIT_ID !== '';

let provider: AppOpenAdProvider | null = null;

function getProvider(): AppOpenAdProvider {
  if (!provider) provider = new AdMobAppOpenAdProvider();
  return provider;
}

/** Test-only: swap the provider. */
export function resetAppOpenAdProviderForTesting(next: AppOpenAdProvider | null): void {
  provider = next;
}

let backgroundedAt: number | null = null;
let photoCaptureInFlight = 0;

/** photo-capture.service から呼ばれる: 撮影/選択の往復中は復帰広告を抑止。 */
export function markPhotoCaptureStart(): void {
  photoCaptureInFlight += 1;
}

export function markPhotoCaptureEnd(): void {
  photoCaptureInFlight = Math.max(0, photoCaptureInFlight - 1);
}

/** AppState が background になった時に呼ぶ。 */
export function noteAppBackgrounded(now = Date.now()): void {
  backgroundedAt = now;
}

/**
 * 起動時に一度呼ぶ: 初回猶予の起点を刻み、最初の 1 枚を裏で読み込んでおく。
 */
export async function initAppOpenAds(): Promise<void> {
  if (!isEnabled()) return;
  try {
    if ((await getAppMeta(FIRST_ELIGIBLE_AT_KEY)) === null) {
      await setAppMeta(FIRST_ELIGIBLE_AT_KEY, String(Date.now() + APP_OPEN_AD_FIRST_GRACE_MS));
      return; // 猶予期間中は読み込みもしない（初日の無駄なリクエストを避ける）
    }
    getProvider().preload();
  } catch {
    // best-effort
  }
}

function parseEpoch(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * AppState が active に戻った時に呼ぶ。ガードを全部通過し、かつ広告が
 * 読み込み済みのときだけ表示する（未読込なら次回に備えて読み込むだけ）。
 */
export async function maybeShowAppOpenAdOnForeground(pathname: string): Promise<void> {
  const wasBackgroundedAt = backgroundedAt;
  backgroundedAt = null;
  if (!isEnabled()) return;
  try {
    const premium = await isPremium().catch(() => false);
    const reason = evaluateAppOpenAdGate({
      enabled: true,
      premium,
      photoCaptureInFlight: photoCaptureInFlight > 0,
      timerStatus: useTimerStore.getState().status,
      pathname,
      backgroundedAt: wasBackgroundedAt,
      lastShownAt: parseEpoch(await getAppMeta(LAST_SHOWN_AT_KEY)),
      firstEligibleAt: parseEpoch(await getAppMeta(FIRST_ELIGIBLE_AT_KEY)),
      now: Date.now(),
    });
    if (reason === 'grace-unset') {
      await setAppMeta(FIRST_ELIGIBLE_AT_KEY, String(Date.now() + APP_OPEN_AD_FIRST_GRACE_MS));
      return;
    }
    if (reason !== 'show') return;

    const adProvider = getProvider();
    if (!adProvider.isLoaded()) {
      adProvider.preload(); // 今回は見送り、次の復帰に備える
      return;
    }
    const shown = await adProvider.show();
    if (shown) {
      await setAppMeta(LAST_SHOWN_AT_KEY, String(Date.now()));
      adProvider.preload();
    }
  } catch {
    // best-effort — 広告は絶対にアプリの動作を妨げない
  }
}
