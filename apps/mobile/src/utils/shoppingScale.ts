/**
 * Ingredient amount scaling for 買い物モード / 料理中モード (US-08, R07).
 *
 * Scales the first numeric token in a free-text amount by the serving ratio.
 * Non-numeric amounts ("適量", "少々" など) are returned unchanged.
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

// Matches the first numeric token, ASCII or full-width (e.g. "200", "２００", "1.5", "１．５").
const NUMBER_TOKEN = /[0-9０-９]+(?:[.．][0-9０-９]+)?/;

/**
 * Scale the first number found in `amount` by `ratio`.
 * Handles both ASCII and full-width digits (Japanese IME input).
 * Returns the input unchanged when it is null, has no number, or ratio is 1.
 */
export function scaleAmount(amount: string | null, ratio: number): string | null {
  if (amount == null || ratio === 1) return amount;
  return amount.replace(NUMBER_TOKEN, (match) =>
    formatScaled(parseFloat(toAsciiNumber(match)) * ratio),
  );
}
