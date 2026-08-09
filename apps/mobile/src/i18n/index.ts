/**
 * i18n の初期化と `t()`。設計は `docs/多言語対応設計.md` §3。
 *
 * 対応ロケールは ja / en のみ。それ以外の端末は **ja にフォールバック**する
 * （現在の配信は日本語圏中心で、未翻訳の言語に半端な英語を出すより一貫する）。
 */
import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';

import en from './locales/en';
import ja from './locales/ja';
import type { CriticalMessage } from './types';

export type Locale = 'ja' | 'en';

/**
 * 辞書のキーを**型として**取り出す（`'error.offline'` のようなドット記法）。
 *
 * これが無いと、キーの打ち間違いは画面に `[missing "…"]` が出るまで気づけない。
 * 700 件を手で移す以上タイポは必ず出るので、**コンパイルで落とす**。
 */
type Leaf = string | CriticalMessage;
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

/** `t()` に渡せるキー。辞書に無い文字列はコンパイルで弾かれる。 */
export type MessageKey = LeafPaths<typeof ja>;
export const SUPPORTED_LOCALES: readonly Locale[] = ['ja', 'en'];
export const DEFAULT_LOCALE: Locale = 'ja';

/**
 * 端末のロケールから対応言語を決める。
 * `en-US` `en-GB` などの地域つきも `en` に寄せる。
 */
export function resolveLocale(languageCodes: readonly string[]): Locale {
  for (const code of languageCodes) {
    const base = code.toLowerCase().split('-')[0];
    if (SUPPORTED_LOCALES.includes(base as Locale)) return base as Locale;
  }
  return DEFAULT_LOCALE;
}

// i18n-js は辞書をネストしたオブジェクトとして扱う。A 階層は { text, intent } の
// オブジェクトなので、そのままでは t() が文字列を返さない。**text を引く**ヘルパーで包む。
const i18n = new I18n({ ja, en });
i18n.enableFallback = true;
i18n.defaultLocale = DEFAULT_LOCALE;
// **端末ロケールは import 時に読まない。** 読むと、テストや CI の結果が
// 実行マシンの言語に左右される（実際 Jest では en と解決され、日本語を
// 期待するテストが環境しだいで落ちた）。既定は ja のままにして、
// 実機での切り替えは起動時の initLocaleFromDevice() で明示的に行う。
i18n.locale = DEFAULT_LOCALE;

/**
 * 端末の言語設定を読んでロケールを決める。**アプリ起動時に一度だけ**呼ぶ。
 * 呼ばなければ ja のまま（テストの既定はこちら）。
 */
export function initLocaleFromDevice(): Locale {
  const locale = resolveLocale(getLocales().map((l) => l.languageTag));
  i18n.locale = locale;
  return locale;
}

/** 現在のロケール。 */
export function getLocale(): Locale {
  return i18n.locale as Locale;
}

/** テスト・設定変更用。 */
export function setLocale(locale: Locale): void {
  i18n.locale = locale;
}

/**
 * 文言を引く。
 *
 * A 階層（`{ text, intent }`）は **text を返す**。intent は翻訳者向けの注釈で、
 * 画面には出さない。呼び出し側が A/B を意識しなくて済むよう、ここで吸収する。
 */
export function t(key: MessageKey, options?: Record<string, unknown>): string {
  const value = i18n.t(key, options) as unknown;
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { text?: unknown }).text === 'string'
  ) {
    return (value as { text: string }).text;
  }
  // キーが無い場合 i18n-js は "[missing ...]" を返す。握りつぶすと画面に出るまで
  // 気づけないので、そのまま返して目立たせる
  return String(value);
}

export { en, ja };
