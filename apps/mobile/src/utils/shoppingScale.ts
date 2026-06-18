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

/**
 * Scale the first number found in `amount` by `ratio`.
 * Returns the input unchanged when it is null, has no number, or ratio is 1.
 */
export function scaleAmount(amount: string | null, ratio: number): string | null {
  if (amount == null || ratio === 1) return amount;
  return amount.replace(/\d+(?:\.\d+)?/, (match) => formatScaled(parseFloat(match) * ratio));
}
