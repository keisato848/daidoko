/**
 * 「足りない材料」の扱いを決める純関数（#214）。
 *
 * 固定したいこと:
 * - **行を落とさない**。在庫にあるものも「なぜ入らないか」付きで返る
 * - 数量は**見ない**。卵が 1 個あっても 3 個要るかは利用者が決める
 * - 「リストにある」を「在庫にある」と言わない（買い忘れに直結する）
 * - 除外がゼロのときだけシートを飛ばす（1 タップの速い道）
 */
import {
  buildShoppingPlan,
  canSkipSelection,
  formatStockAmount,
  type PantryStock,
} from '../shoppingPlan';

const ING = [
  { name: '玉ねぎ', amount: '1個' },
  { name: '卵', amount: '3個' },
  { name: '砂糖', amount: '大さじ1' },
];

const STOCKS: PantryStock[] = [
  { nameNormalized: '卵', quantity: 1, unit: '個' },
  { nameNormalized: '醤油', quantity: 1, unit: '本' },
];

describe('buildShoppingPlan', () => {
  it('在庫にある材料も行として残り、理由と手持ちが付く', () => {
    const rows = buildShoppingPlan(ING, STOCKS, []);
    expect(rows).toHaveLength(3);
    const egg = rows.find((r) => r.name === '卵');
    expect(egg).toMatchObject({
      status: 'in-pantry',
      selected: false,
      stockQuantity: 1,
      stockUnit: '個',
      amount: '3個',
    });
  });

  it('在庫に無いものだけ既定でチェックが入る', () => {
    const rows = buildShoppingPlan(ING, STOCKS, []);
    expect(rows.filter((r) => r.selected).map((r) => r.name)).toEqual(['玉ねぎ', '砂糖']);
  });

  it('数量が足りていなくても在庫扱いのまま（引き算しない）', () => {
    // 卵は 3 個要るのに在庫 1 個。それでも status は in-pantry で、判断は利用者に返す
    const rows = buildShoppingPlan([{ name: '卵', amount: '3個' }], STOCKS, []);
    expect(rows[0].status).toBe('in-pantry');
    expect(rows[0].selected).toBe(false);
  });

  it('リストにある材料は「在庫にある」と言わない', () => {
    const rows = buildShoppingPlan(ING, STOCKS, ['砂糖']);
    const sugar = rows.find((r) => r.name === '砂糖');
    expect(sugar?.status).toBe('on-list');
    expect(sugar?.stockQuantity).toBeNull();
  });

  it('リストと在庫の両方にあるときは「リストにある」を優先する', () => {
    const rows = buildShoppingPlan([{ name: '卵', amount: '3個' }], STOCKS, ['卵']);
    expect(rows[0].status).toBe('on-list');
  });

  it('名寄せ辞書が効く（とっとごたまご→卵）', () => {
    const rows = buildShoppingPlan([{ name: 'とっとごたまご', amount: '2個' }], STOCKS, [], {
      とっとごたまご: '卵',
    });
    expect(rows[0].status).toBe('in-pantry');
  });

  it('数量未管理（null）の在庫でも在庫扱い', () => {
    const rows = buildShoppingPlan(
      [{ name: '塩', amount: '少々' }],
      [{ nameNormalized: '塩', quantity: null, unit: null }],
      [],
    );
    expect(rows[0].status).toBe('in-pantry');
    expect(rows[0].stockQuantity).toBeNull();
  });
});

describe('canSkipSelection', () => {
  it('全部足りないならシートを出さない', () => {
    expect(canSkipSelection(buildShoppingPlan(ING, [], []))).toBe(true);
  });

  it('1 つでも除外があればシートを出す', () => {
    expect(canSkipSelection(buildShoppingPlan(ING, STOCKS, []))).toBe(false);
  });

  it('材料が無いレシピでは出さない', () => {
    expect(canSkipSelection([])).toBe(false);
  });
});

describe('formatStockAmount', () => {
  it('単位があれば付ける。無ければ数だけ', () => {
    expect(formatStockAmount(1, '個')).toBe('1個');
    expect(formatStockAmount(2.5, null)).toBe('2.5');
  });

  it('数量未管理は空（「在庫」とだけ出す側で扱う）', () => {
    expect(formatStockAmount(null, '個')).toBe('');
  });
});
