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
import { isCriticalMessage } from './types';
import type { CriticalMessage, CriticalPluralMessage, PluralMessage } from './types';

export type Locale = 'ja' | 'en';

/**
 * 辞書のキーを**型として**取り出す（`'error.offline'` のようなドット記法）。
 *
 * これが無いと、キーの打ち間違いは画面に `[missing "…"]` が出るまで気づけない。
 * 900 件超を手で移す以上タイポは必ず出るので、**コンパイルで落とす**。
 */
type AnyPlural = PluralMessage | CriticalPluralMessage;
type Leaf = string | CriticalMessage | AnyPlural;
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

/** 数が入る文言だけを取り出す（`tCount()` 専用）。 */
type PluralPaths<T> = {
  [K in keyof T & string]: T[K] extends AnyPlural
    ? K
    : T[K] extends Leaf
      ? never
      : `${K}.${PluralPaths<T[K]>}`;
}[keyof T & string];

/** `tCount()` に渡せるキー。数の入らない文言を渡すとコンパイルで落ちる。 */
export type PluralKey = PluralPaths<typeof ja>;

/**
 * `t()` に渡せるキー。辞書に無い文字列はコンパイルで弾かれる。
 * **数の入る文言は除く** — `t()` で引くと単複が選ばれないため、`tCount()` を使う。
 */
export type MessageKey = Exclude<LeafPaths<typeof ja>, PluralKey>;
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

/**
 * i18n-js に渡す辞書を作る。**A 階層の `intent` を落として text だけにする。**
 *
 * intent は翻訳する人と意味検査のためのもので、i18n-js は知らなくてよい。
 * 渡してしまうと、複数形を選んだあとに `{text,intent}` を文字列として
 * 補間しようとして落ちる（`message.match is not a function`）。
 */
function toPlainDictionary(node: unknown): unknown {
  if (isCriticalMessage(node)) return node.text;
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, value]) => [
        key,
        toPlainDictionary(value),
      ]),
    );
  }
  return node;
}

const i18n = new I18n({
  ja: toPlainDictionary(ja) as Record<string, unknown>,
  en: toPlainDictionary(en) as Record<string, unknown>,
});
i18n.enableFallback = true;
i18n.defaultLocale = DEFAULT_LOCALE;
// 日本語に単複の区別はない。既定（英語の規則）のままだと count=1 のとき
// `one` を探しに行き、日本語辞書には無いので落ちる。**常に other を使う**
i18n.pluralization.register('ja', () => ['other']);
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

function translate(key: string, options?: Record<string, unknown>): string {
  const value = i18n.t(key, options) as unknown;
  if (typeof value === 'string') return value;
  // キーが無い場合 i18n-js は "[missing ...]" を返す。握りつぶすと画面に出るまで
  // 気づけないので、そのまま返して目立たせる
  return String(value);
}

/**
 * 文言を引く。辞書に無いキー・数の入る文言はコンパイルで弾かれる。
 * A 階層の `intent` は辞書の構築時に落としてあるので、ここでは常に文字列が返る。
 */
export function t(key: MessageKey, options?: Record<string, unknown>): string {
  return translate(key, options);
}

/**
 * 数が入る文言を引く。`{{count}}` に数が入り、英語は単複が選ばれる。
 *
 * `t()` と分けているのは**取り違えを型で止める**ため。`t()` に複数形の文言を
 * 渡すと、i18n-js は `{one, other}` のオブジェクトを返し、画面に
 * `[object Object]` が出る。
 */
export function tCount(key: PluralKey, count: number, options?: Record<string, unknown>): string {
  return translate(key, { ...options, count });
}

/** 辞書に実在するキーの集合。実行時に決まるキー（Zod のメッセージ）の判定に使う。 */
const KNOWN_KEYS = new Set<string>();
(function collectKeys(node: unknown, prefix: string): void {
  if (typeof node === 'string') {
    KNOWN_KEYS.add(prefix);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    collectKeys(value, prefix ? `${prefix}.${key}` : key);
  }
})(toPlainDictionary(ja), '');

/**
 * **実行時にキーが決まる**文言を引く。
 *
 * Zod のメッセージはスキーマを定義した時点で確定するので、そこで `t()` を
 * 呼ぶと import 時のロケールに固定される。代わりに辞書のキーを持たせておき、
 * 画面に出す直前にここで引く。
 *
 * 辞書に無い文字列（ライブラリ既定のメッセージなど）はそのまま返す。
 */
export function tDynamic(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return KNOWN_KEYS.has(message) ? translate(message) : message;
}

export { en, ja };
