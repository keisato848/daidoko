/**
 * App-wide configuration
 * SERVER_BASE_URL: Hono API server endpoint
 */
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

// EXPO_PUBLIC_SERVER_URL を設定している場合はそちらを優先
// 未設定時のデフォルト:
//   Web (開発)  → localhost:3000
//   Native      → Railway 本番サーバー
export const SERVER_BASE_URL =
  process.env['EXPO_PUBLIC_SERVER_URL'] ??
  (isWeb ? 'http://localhost:3000' : 'https://daidoko-production.up.railway.app');

export const API_V1 = `${SERVER_BASE_URL}/api/v1`;

// RevenueCat の公開 SDK キー（プラットフォーム別）。
// 未設定なら課金は無効化され、無料枠のみでアプリは完全に動作する（Stub プロバイダ）。
export const REVENUECAT_API_KEY = process.env['EXPO_PUBLIC_REVENUECAT_API_KEY'] ?? '';

// リワード広告（AdMob）の有効化フラグ。既定 false ＝ 広告 UI 非表示で挙動不変。
// 動作確認は EXPO_PUBLIC_ADMOB_ENABLED=true でビルド（app.json のテスト ID で Google テスト広告が出る）。
export const ADMOB_ENABLED = process.env['EXPO_PUBLIC_ADMOB_ENABLED'] === 'true';

// AI 写真レシピの無料枠（1 日あたり）。既定 1。ビルド時に調整可能
// （0 にすると常にペイウォール — 広告フローの E2E 検証にも使う）。
// 注意: Number('') は 0 になるため、未設定・空文字は先に弾く。
const rawFreeLimit = process.env['EXPO_PUBLIC_FREE_DAILY_LIMIT'];
const parsedFreeLimit = rawFreeLimit ? Number(rawFreeLimit) : NaN;
export const FREE_DAILY_LIMIT_CONFIG =
  Number.isInteger(parsedFreeLimit) && parsedFreeLimit >= 0 ? parsedFreeLimit : 1;
// リワード広告ユニット ID。未設定なら SDK の公式テスト ID（TestIds.REWARDED）を使う。
export const ADMOB_REWARDED_UNIT_ID = process.env['EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID'] ?? '';
// アプリ起動広告ユニット ID。未設定なら SDK の公式テスト ID（TestIds.APP_OPEN）を使う。
export const ADMOB_APP_OPEN_UNIT_ID = process.env['EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID'] ?? '';

// BYOK（持ち込みキー）で端末から直接呼ぶ Gemini モデル。サーバー側の既定と揃える。
export const GEMINI_MODEL = process.env['EXPO_PUBLIC_GEMINI_MODEL'] ?? 'gemini-2.5-flash';
