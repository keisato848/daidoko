/**
 * M3（不足分レシピの一括生成・§10.12）の純関数。
 * - `appendShortfallDays`: 空き日への組み込み（既存の日は触らない・requestedDays を超えない）
 * - `mergeMenuIngredients`: #214 の選択シートへ渡す全材料の 1 行化
 * - reason `'ai-new'` の往復（片方だけ直すと理由が黙って消える）
 */
import {
  appendShortfallDays,
  decodeReason,
  encodeReason,
  mergeMenuIngredients,
  type MenuRecipe,
  type RollableMenuDay,
} from '../menuPlan';

function day(dayNo: number, recipeId: string, doneAt: string | null = null): RollableMenuDay {
  return { day: dayNo, recipeId, title: `レシピ${recipeId}`, reason: 'coverage:3', doneAt };
}

function recipe(id: string, ingredients: { name: string; amount: string | null }[]): MenuRecipe {
  return {
    id,
    title: `レシピ${id}`,
    cookTimeMin: null,
    pinnedAt: null,
    lastCookedAt: null,
    ingredients,
  };
}

describe('appendShortfallDays', () => {
  it('最終日の次の day 番号から順に積む。既存の日は一切触らない', () => {
    const current = [day(1, 'a'), day(2, 'b')];
    const result = appendShortfallDays(current, 5, [
      { recipeId: 'x', title: '新レシピX' },
      { recipeId: 'y', title: '新レシピY' },
    ]);
    expect(result.slice(0, 2)).toEqual(current);
    expect(result[2]).toMatchObject({ day: 3, recipeId: 'x', title: '新レシピX', doneAt: null });
    expect(result[3]).toMatchObject({ day: 4, recipeId: 'y' });
  });

  it('reason は ai-new（subject 無し）で保存される', () => {
    const result = appendShortfallDays([], 1, [{ recipeId: 'x', title: 'X' }]);
    expect(decodeReason(result[0].reason)).toEqual({ kind: 'ai-new', subject: '' });
  });

  it('requestedDays を超えては積まない（超えたぶんは捨てる）', () => {
    const result = appendShortfallDays([day(1, 'a')], 2, [
      { recipeId: 'x', title: 'X' },
      { recipeId: 'y', title: 'Y' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].recipeId).toBe('x');
  });

  it('既に献立にいるレシピは積まない（同じレシピを 2 つの日に入れない）', () => {
    const result = appendShortfallDays([day(1, 'a')], 3, [
      { recipeId: 'a', title: '既存と同じ' },
      { recipeId: 'x', title: 'X' },
    ]);
    expect(result.map((d) => d.recipeId)).toEqual(['a', 'x']);
  });

  it('追加が無ければそのまま返す', () => {
    const current = [day(1, 'a')];
    expect(appendShortfallDays(current, 3, [])).toEqual(current);
  });
});

describe('mergeMenuIngredients — #214 シートへ渡す全材料（在庫にあるか問わない）', () => {
  it('複数日の同じ材料は 1 行にまとめ、分量を「 / 」で連結する', () => {
    const recipes = [
      recipe('a', [{ name: '玉ねぎ', amount: '1個' }]),
      recipe('b', [{ name: '玉ねぎ', amount: '1/2個' }]),
    ];
    const result = mergeMenuIngredients([{ recipeId: 'a' }, { recipeId: 'b' }], recipes);
    expect(result).toEqual([{ name: '玉ねぎ', amount: '1個 / 1/2個', recipeId: 'a' }]);
  });

  it('分量が無い材料は amount: null', () => {
    const recipes = [recipe('a', [{ name: '塩', amount: null }])];
    expect(mergeMenuIngredients([{ recipeId: 'a' }], recipes)).toEqual([
      { name: '塩', amount: null, recipeId: 'a' },
    ]);
  });

  it('消えたレシピの日は飛ばす', () => {
    expect(mergeMenuIngredients([{ recipeId: 'gone' }], [])).toEqual([]);
  });
});

describe("reason 'ai-new' の往復", () => {
  it('encode → decode で往復できる', () => {
    expect(decodeReason(encodeReason('ai-new', null))).toEqual({ kind: 'ai-new', subject: '' });
  });
});
