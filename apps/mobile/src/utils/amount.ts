/**
 * Best-effort parse of a free-text amount ("2個", "100g", "大さじ1", "少々")
 * into a numeric quantity + unit, for moving shopping items into the pantry.
 * Leading number → quantity, the rest → unit. No leading number → quantity null,
 * the whole string as unit. See docs/買い物リスト・在庫設計.md §5.2.
 */
export function parseAmount(amount: string | null | undefined): {
  quantity: number | null;
  unit: string | null;
} {
  if (!amount) return { quantity: null, unit: null };
  const normalized = typeof amount.normalize === 'function' ? amount.normalize('NFKC') : amount;
  const s = normalized.trim();
  if (!s) return { quantity: null, unit: null };

  const match = s.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (match) {
    const quantity = Number(match[1]);
    const unit = match[2].trim();
    return {
      quantity: Number.isFinite(quantity) ? quantity : null,
      unit: unit.length > 0 ? unit : null,
    };
  }
  return { quantity: null, unit: s };
}
