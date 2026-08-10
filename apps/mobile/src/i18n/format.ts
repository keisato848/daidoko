/**
 * 日付・数量の書式。**辞書ではなく書式の問題**なので分けている。
 *
 * `Intl.DateTimeFormat` は使わない。React Native の Intl は端末・OS で
 * 揃わず、同じ日付が端末によって違う形で出る。ここでは月名を持ち、
 * 自前で組み立てる（12 語なので持つコストは小さい）。
 */
import { getLocale } from './index';

const MONTH_SHORT_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MONTH_LONG_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 一覧の日付見出し。ja: `08月04日` / en: `Aug 4` */
export function formatMonthDay(date: Date): string {
  if (getLocale() === 'en') return `${MONTH_SHORT_EN[date.getMonth()]} ${date.getDate()}`;
  return `${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日`;
}

/** 月の見出し。ja: `8月` / en: `August` */
export function formatMonthLabel(date: Date): string {
  if (getLocale() === 'en') return MONTH_LONG_EN[date.getMonth()];
  return `${date.getMonth() + 1}月`;
}

/** 日時（バックアップ一覧など）。ja: `2026/08/04 13:05` / en: `Aug 4, 2026 13:05` */
export function formatDateTime(date: Date): string {
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (getLocale() === 'en') {
    return `${MONTH_SHORT_EN[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ${time}`;
  }
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${time}`;
}

/** 年つきの月見出し。ja: `2026年8月` / en: `August 2026` */
export function formatYearMonth(date: Date): string {
  if (getLocale() === 'en') return `${MONTH_LONG_EN[date.getMonth()]} ${date.getFullYear()}`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

/**
 * 数値と単位をつなぐ。ja: `4人前` / en: `4 servings`
 *
 * 空白の有無は言語の組版の決まりであって訳ではないので、辞書ではなくここで決める
 * （単位ごとに空白入りの訳を用意すると、空白が消えても誰も気づけない）。
 * 実機の英語表示が「4servings」になっていたのが発端。
 */
export function formatValueWithUnit(value: number, unit: string | undefined): string {
  if (unit === undefined || unit === '') return String(value);
  return getLocale() === 'ja' ? `${value}${unit}` : `${value} ${unit}`;
}
