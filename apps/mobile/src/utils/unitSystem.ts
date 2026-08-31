/**
 * 単位系（P1・`docs/多言語対応設計.md` §4）。
 *
 * **AI は「180度」「大さじ1」を出す。米国の利用者に 180°F と読まれれば料理が失敗する。**
 * 単位は翻訳ではなく「正しさ」の問題なので、言語とは別の設定として持つ
 * （英国の利用者は英語だがメートル法）。
 *
 * ここは表示のための整形だけを行う。**保存値は原文のまま**にする — 変換して
 * 保存すると丸め誤差が版を重ねるたびに積もり、`recipeDiff` が「変わっていないのに
 * 変わった」と出して R2（感想でレシピを調整する機能）の安全装置を壊す。
 *
 * 変換は**確実に分かるものだけ**。読み切れない表記（「適量」「1袋」）は触らない。
 * 迷ったら原文のまま出す方が、間違った数字を出すより安全。
 */

export type UnitSystem = 'metric' | 'imperial';

export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'metric';

/**
 * 端末の地域から既定の単位系を決める。
 * ヤード・ポンド法を日常的に使う国はごく少ない（米国とその周辺）。
 * 判定できないときはメートル法（世界の大半・保存値もこちら側）。
 */
export function unitSystemForRegion(region: string | null | undefined): UnitSystem {
  if (!region) return DEFAULT_UNIT_SYSTEM;
  return ['US', 'LR', 'MM'].includes(region.toUpperCase()) ? 'imperial' : DEFAULT_UNIT_SYSTEM;
}

// ─── 数値の整形 ───────────────────────────────────────────────────────────────

/** 全角の数字・小数点を ASCII に寄せる（日本語 IME の入力が混ざるため）。 */
function toAsciiNumber(text: string): string {
  return text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.');
}

/**
 * 台所で使える丸め方にする。0.25 未満は 1/8 単位、それ以外は有効数字 2〜3 桁。
 * 「1.7637 oz」のような数字は料理には無意味なので出さない。
 */
function formatCookingNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return String(Math.round(value * 2) / 2);
  if (value >= 1) return trimZero(Math.round(value * 4) / 4);
  // 1 未満は小数でなく**分数**で出す。「0.38 oz」は機械の換算値にしか見えない —
  // 英語圏のレシピ表記は 3/8・1/4 のような分数が慣習
  // （ペルソナレビュー 1.12.2 #16・英語話者の指摘）
  const eighths = Math.round(value * 8);
  if (eighths <= 0) return trimZero(value);
  if (eighths >= 8) return '1';
  const FRACTIONS = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];
  return FRACTIONS[eighths];
}

function trimZero(value: number): string {
  return String(Number(value.toFixed(2)));
}

// ─── 分量 ─────────────────────────────────────────────────────────────────────

const GRAMS_PER_OUNCE = 28.3495;
const GRAMS_PER_POUND = 453.592;
const ML_PER_FLUID_OUNCE = 29.5735;
const ML_PER_CUP = 236.588;

/**
 * 質量・容量の単位。**単位の直後に別の文字が続く場合は変換しない**
 * （「1kg入り」の「入り」は残す必要があるので後読みで許すが、
 * 「gあたり」のような語の一部を拾わないよう単語境界を見る）。
 */
const AMOUNT_PATTERN =
  /([0-9０-９]+(?:[.．][0-9０-９]+)?)\s*(kg|ｋｇ|g|ｇ|ml|ｍｌ|mL|l|L|ℓ|リットル|cc)(?![a-zA-Z0-9ａ-ｚＡ-Ｚ０-９])/g;

/**
 * メートル法の分量をヤード・ポンド法の表示に直す。
 * `metric` のときは何もしない（保存値がメートル法寄りのため）。
 */
export function convertAmountForDisplay(amount: string | null, system: UnitSystem): string | null {
  if (amount == null || system === 'metric') return amount;

  return amount.replace(AMOUNT_PATTERN, (match, rawValue: string, rawUnit: string) => {
    const value = Number.parseFloat(toAsciiNumber(rawValue));
    if (!Number.isFinite(value)) return match;

    // 単位も全角で書かれる（「２００ｇ」）。NFKC で半角へ寄せてから判定する
    const unit = rawUnit.normalize('NFKC').toLowerCase();
    switch (unit) {
      case 'kg':
        return `${formatCookingNumber((value * 1000) / GRAMS_PER_POUND)} lb`;
      case 'g': {
        // ポンドは 1/4 刻みでしか読まないので、2 ポンド未満はオンスの方が正確。
        // 500g を「1 lb」と出すと 1 割ずれる
        const ounces = value / GRAMS_PER_OUNCE;
        return ounces >= 32
          ? `${formatCookingNumber(value / GRAMS_PER_POUND)} lb`
          : `${formatCookingNumber(ounces)} oz`;
      }
      case 'ml':
      case 'cc': {
        // 1 カップを超えるならカップの方が読みやすい
        return value >= ML_PER_CUP
          ? `${formatCookingNumber(value / ML_PER_CUP)} cups`
          : `${formatCookingNumber(value / ML_PER_FLUID_OUNCE)} fl oz`;
      }
      case 'l':
      case 'ℓ':
      // i18n-ignore: 画面に出す文字ではなく、レシピ本文に書かれている単位の表記そのもの
      // eslint-disable-next-line no-restricted-syntax
      case 'リットル':
        return `${formatCookingNumber((value * 1000) / ML_PER_CUP)} cups`;
      default:
        return match;
    }
  });
}

// ─── 温度 ─────────────────────────────────────────────────────────────────────

/**
 * 手順本文の温度。℃ / °C は無条件、「度」は**加熱の温度らしい範囲だけ**変換する。
 * 「2度揚げる」「3度に分けて」を温度と読むと数字が化けるため。
 */
const CELSIUS_PATTERN = /([0-9０-９]+(?:[.．][0-9０-９]+)?)\s*(℃|°C|度)/g;
const OVEN_TEMPERATURE_MIN = 40;
const OVEN_TEMPERATURE_MAX = 300;

/** 華氏は 5 度刻みに丸める（オーブンのつまみがその刻みなので）。 */
function toFahrenheit(celsius: number): number {
  return Math.round(((celsius * 9) / 5 + 32) / 5) * 5;
}

export function convertTemperaturesForDisplay(text: string, system: UnitSystem): string;
export function convertTemperaturesForDisplay(
  text: string | null,
  system: UnitSystem,
): string | null;
export function convertTemperaturesForDisplay(
  text: string | null,
  system: UnitSystem,
): string | null {
  if (text == null || system === 'metric') return text;

  return text.replace(CELSIUS_PATTERN, (match, rawValue: string, unit: string) => {
    const celsius = Number.parseFloat(toAsciiNumber(rawValue));
    if (!Number.isFinite(celsius)) return match;
    // 「度」だけは温度と断定できないので、加熱の温度らしい範囲に限る
    // i18n-ignore: 手順本文に書かれている単位の表記そのもの（訳す対象ではない）
    // eslint-disable-next-line no-restricted-syntax
    if (unit === '度' && (celsius < OVEN_TEMPERATURE_MIN || celsius > OVEN_TEMPERATURE_MAX)) {
      return match;
    }
    return `${toFahrenheit(celsius)}°F`;
  });
}
