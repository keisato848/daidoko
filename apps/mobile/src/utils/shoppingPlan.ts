/**
 * レシピの材料を買い物リストへ入れるときの「何をどう扱うか」を決める純関数（#214）。
 *
 * **数量の引き算はしない。** レシピの分量は自由文（「大さじ2」「少々」「1/2本」）で、
 * 在庫側は数値＋任意の単位。揃うのは一部だけで、揃わないまま引き算すると
 * **自信を持って間違えた買い物リスト**ができる（買い忘れは目に見えない）。
 * 類似アプリの調べでも、引き算するのは在庫特化の Grocy だけで、
 * それは製品マスタと単位換算の登録が前提だった（`docs/買い物リスト・在庫設計.md` §5.3-a）。
 *
 * 代わりに**除外の理由を見せて、利用者に選ばせる**。Paprika もクラシルも
 * 「在庫にある物はチェックを外して見せる」であって、一覧から消してはいない。
 */
import { itemNamesMatch } from './itemMatch';

/** 在庫の 1 行（突合に必要な分だけ） */
export interface PantryStock {
  nameNormalized: string;
  quantity: number | null;
  unit: string | null;
}

/** なぜ既定でチェックが外れているか */
export type IngredientStatus =
  /** 在庫にも買い物リストにも無い＝買う */
  | 'missing'
  /** 在庫にある（数量は見ていない。足りないかは利用者が決める） */
  | 'in-pantry'
  /** すでに買い物リストに入っている（未購入） */
  | 'on-list';

export interface ShoppingPlanRow {
  /** レシピの材料名（表示にも追加にもこれを使う） */
  name: string;
  /** レシピの分量。null なら未記入 */
  amount: string | null;
  status: IngredientStatus;
  /** 在庫にある場合の手持ち。表示用（例: 1 と '個' → 「在庫 1個」） */
  stockQuantity: number | null;
  stockUnit: string | null;
  /** 既定でチェックを入れるか。`missing` だけ true */
  selected: boolean;
}

function findStock(
  ingredientName: string,
  stocks: readonly PantryStock[],
  aliases: Record<string, string>,
): PantryStock | null {
  return (
    stocks.find((stock) => itemNamesMatch(ingredientName, stock.nameNormalized, aliases)) ?? null
  );
}

/**
 * 材料ごとの扱いを決める。**行は 1 つも落とさない** — 除外したものも
 * 理由付きで返すのが目的（落とすと「なぜ入らなかったのか」が消える）。
 *
 * @param pendingListNames 買い物リストにある未購入の品名（正規化前でよい）
 */
export function buildShoppingPlan(
  ingredients: readonly { name: string; amount: string | null }[],
  stocks: readonly PantryStock[],
  pendingListNames: readonly string[],
  aliases: Record<string, string> = {},
): ShoppingPlanRow[] {
  return ingredients.map((ingredient) => {
    const onList = pendingListNames.some((listed) =>
      itemNamesMatch(ingredient.name, listed, aliases),
    );
    const stock = onList ? null : findStock(ingredient.name, stocks, aliases);
    const status: IngredientStatus = onList ? 'on-list' : stock ? 'in-pantry' : 'missing';
    return {
      name: ingredient.name,
      amount: ingredient.amount,
      status,
      stockQuantity: stock?.quantity ?? null,
      stockUnit: stock?.unit ?? null,
      selected: status === 'missing',
    };
  });
}

/**
 * シートを出さずに済むか。**除外が 1 つも無ければ出さない**
 * （全部足りないなら選ぶことが無いので、1 タップの速い道を残す）。
 */
export function canSkipSelection(rows: readonly ShoppingPlanRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.status === 'missing');
}

/** 在庫の手持ちを「1個」「1」の形にする。数量未管理（null）は空文字 */
export function formatStockAmount(quantity: number | null, unit: string | null): string {
  if (quantity == null) return '';
  const rounded = Number.isInteger(quantity) ? String(quantity) : String(quantity);
  return unit ? `${rounded}${unit}` : rounded;
}
