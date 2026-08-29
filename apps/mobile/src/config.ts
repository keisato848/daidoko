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

// RevenueCat の公開 SDK キーは後段（platformValue の定義後）で解決する。

// リワード広告（AdMob）の有効化フラグ。既定 false ＝ 広告 UI 非表示で挙動不変。
// 動作確認は EXPO_PUBLIC_ADMOB_ENABLED=true でビルド（app.json のテスト ID で Google テスト広告が出る）。
export const ADMOB_ENABLED = process.env['EXPO_PUBLIC_ADMOB_ENABLED'] === 'true';

// AI 利用（写真レシピ・AI 献立並べ替え共通の全体枠）の無料枠（月あたり）。既定 5。
// env 名は歴史的に EXPO_PUBLIC_FREE_DAILY_LIMIT のまま（詳細は usage.service.ts 冒頭）。
// ビルド時に調整可能（0 にすると常にペイウォール — 広告フローの E2E 検証にも使う）。
// 注意: Number('') は 0 になるため、未設定・空文字は先に弾く。
const rawFreeLimit = process.env['EXPO_PUBLIC_FREE_DAILY_LIMIT'];
const parsedFreeLimit = rawFreeLimit ? Number(rawFreeLimit) : NaN;
export const FREE_DAILY_LIMIT_CONFIG =
  Number.isInteger(parsedFreeLimit) && parsedFreeLimit >= 0 ? parsedFreeLimit : 5;
// ── 広告ユニット ID ─────────────────────────────────────────────────────────
// AdMob のユニットは**アプリ（=プラットフォーム）ごと**に別物。iOS でも広告を出す方針に
// なった（2026-08-12）ので、無印 = Android・`_IOS` 付き = iOS として持ち、
// ここで実行中のプラットフォームのものに解決する。
//
// **未設定（空文字）はそのフォーマットを丸ごと無効にする。** admob プロバイダには
// 「空ならテスト ID」のフォールバックがあるため、ここで空を通してしまうと
// **本番ビルドにテスト広告が出る**（iOS のユニットを作る前に踏みかけた）。
// 空かどうかの判定は各サービスの isConfigured 側で行う。
function platformValue(android: string | undefined, ios: string | undefined): string {
  return (Platform.OS === 'ios' ? ios : android) ?? '';
}

// リワード広告ユニット ID。
export const ADMOB_REWARDED_UNIT_ID = platformValue(
  process.env['EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID'],
  process.env['EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID_IOS'],
);
// アプリ起動広告ユニット ID。
export const ADMOB_APP_OPEN_UNIT_ID = platformValue(
  process.env['EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID'],
  process.env['EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID_IOS'],
);
// バナー広告ユニット ID（一覧系画面の下部）。料理中モードには出さない
// （ストア掲載文で「広告なし」を約束している）。
export const ADMOB_BANNER_UNIT_ID = platformValue(
  process.env['EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID'],
  process.env['EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_IOS'],
);

// RevenueCat の公開 SDK キー。**ストアごとに完全に別物**（Play=`goog_…` / App Store=`appl_…`）で、
// 片方のキーでもう片方のストアを叩くと購入フローが必ず落ちる。
// `eas.json` の production プロファイルは同じ env を全プラットフォームへ配るので、
// 変数 1 本では Android と iOS のどちらかが必ず壊れる（AdMob のユニット ID で同じ罠を踏んだ）。
// 無印 = Android・`_IOS` = iOS の対応は広告ユニットと揃えてある。
//
// 未設定なら課金は無効化され、無料枠と広告だけでアプリは完全に動作する（Stub プロバイダ）。
export const REVENUECAT_API_KEY = platformValue(
  process.env['EXPO_PUBLIC_REVENUECAT_API_KEY'],
  process.env['EXPO_PUBLIC_REVENUECAT_API_KEY_IOS'],
);

// BYOK（持ち込みキー）で端末から直接呼ぶ Gemini モデル。サーバー側の既定と揃える。
export const GEMINI_MODEL = process.env['EXPO_PUBLIC_GEMINI_MODEL'] ?? 'gemini-2.5-flash';

// 献立の AI 並べ替え（M2）ボタンの表示フラグ。既定 false ＝ ボタン非表示（挙動不変）。
// M2 は評価 2 周（docs/eval/menu-rank/2026-08-29-round2-*）でも F 軸（ジャンルの散り）が
// 未達のまま終わり、`docs/買い物リスト・在庫設計.md` §10.10.5 の判断ルール
// 「2 周しても未達 → M2 を見送り M1 のまま」に該当した（2026-08-29 管理役裁定）。
// コードは A2/R6（プレミアム自動モード・献立ウィジェット）の土台として残し、
// UI だけこのフラグで隠す。再挑戦するときは EXPO_PUBLIC_MENU_AI_ENABLED=true で
// ビルドして評価をやり直す。
export const MENU_AI_ENABLED = process.env['EXPO_PUBLIC_MENU_AI_ENABLED'] === 'true';
