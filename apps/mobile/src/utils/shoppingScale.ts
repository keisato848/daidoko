/**
 * Ingredient amount scaling for 買い物モード / レシピ詳細 / 料理中モード (US-08, R07).
 *
 * Scales every numeric token in a free-text amount by the serving ratio.
 * Fractions ("1/2個") are treated as one token (so ×2 → "1個", not "2/2個"),
 * and ranges ("2〜3本") scale both ends. Non-numeric amounts ("適量", "少々"
 * など) are returned unchanged.
 */

/** Serving ratio from a base to a target count. Falls back to 1 when unknown/invalid. */
export function servingRatio(base: number | null, target: number): number {
  if (!base || base <= 0 || target <= 0) return 1;
  return target / base;
}

/** Round to at most 1 decimal place, dropping a trailing ".0". */
function formatScaled(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return String(rounded);
}

/** Normalize full-width digits/period (２００．５) to ASCII so they can be parsed. */
function toAsciiNumber(s: string): string {
  return s
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.');
}

// Matches a fraction ("1/2", "１／２" — captured as num/den) or a plain numeric
// token, ASCII or full-width (e.g. "200", "２００", "1.5", "１．５"). The
// fraction alternative comes first so "1/2" scales as one value.
const NUMBER_OR_FRACTION_TOKEN =
  /([0-9０-９]+)\s*[/／]\s*([0-9０-９]+)|[0-9０-９]+(?:[.．][0-9０-９]+)?/g;

/**
 * Scale every number found in `amount` by `ratio`.
 * Handles both ASCII and full-width digits (Japanese IME input).
 * Returns the input unchanged when it is null, has no number, or ratio is 1.
 */
export function scaleAmount(amount: string | null, ratio: number): string | null {
  if (amount == null || ratio === 1) return amount;
  return amount.replace(NUMBER_OR_FRACTION_TOKEN, (match, numerator, denominator) => {
    const value =
      numerator != null && denominator != null
        ? parseFloat(toAsciiNumber(numerator)) / parseFloat(toAsciiNumber(denominator))
        : parseFloat(toAsciiNumber(match));
    return formatScaled(value * ratio);
  });
}
