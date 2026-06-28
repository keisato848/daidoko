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
