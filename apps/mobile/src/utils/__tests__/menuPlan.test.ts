/**
 * 献立 M1 の純関数（#215・設計 §10.2〜10.4）。
 *
 * ここで固定するのは**設計の背骨**であって実装の細部ではない:
 * 数量を計算しないこと・取り分けの調味料を食い合いに数えないこと・
 * 埋めないこと・引き当てグラフに順序を付けないこと。
 */
import {
  applyArrangement,
  buildArrangeCandidates,
  buildClaims,
  buildMenu,
  decodeReason,
  encodeReason,
  expiryUrgency,
  isContested,
  isServingAmount,
  recencyPenalty,
  scoreRecipe,
  type ArrangeableDay,
  type MenuPantryItem,
  type MenuRecipe,
} from '../menuPlan';

const TODAY = new Date(2026, 7, 28); // 2026-08-28

function recipe(over: Partial<MenuRecipe> & { id: string }): MenuRecipe {
  return {
    title: over.id,
    cookTimeMin: 20,
    pinnedAt: null,
    lastCookedAt: null,
    ingredients: [],
    ...over,
  };
}

function pantry(id: string, name: string, expiresOn: string | null = null): MenuPantryItem {
  return { id, name, expiresOn };
}

describe('isServingAmount — 取り分けの調味料', () => {
  it.each(['大さじ2', '小さじ1/2', '少々', '適量', 'お好みで', 'カップ1', '1 tbsp'])(
    '「%s」は取り分けと見なす',
    (amount) => {
      expect(isServingAmount(amount)).toBe(true);
    },
  );

  it.each(['2個', '1本', '300g', null])('「%s」は取り分けではない', (amount) => {
    expect(isServingAmount(amount)).toBe(false);
  });

  it('全角・大文字でも拾う（NFKC 正規化しているため）', () => {
    expect(isServingAmount('大さじ２')).toBe(true);
    expect(isServingAmount('1 TBSP')).toBe(true);
  });
});

describe('expiryUrgency — 期限は最も近い 1 件で決める', () => {
  it('段階が設計どおり（≤1日:1.0 / ≤3日:0.8 / ≤7日:0.5 / 他:0）', () => {
    expect(expiryUrgency('2026-08-28', TODAY)).toBe(1.0);
    expect(expiryUrgency('2026-08-30', TODAY)).toBe(0.8);
    expect(expiryUrgency('2026-09-03', TODAY)).toBe(0.5);
    expect(expiryUrgency('2026-12-31', TODAY)).toBe(0);
  });

  it('期限が入っていない在庫は 0（#200 の方針で大半が null）', () => {
    expect(expiryUrgency(null, TODAY)).toBe(0);
  });
});

describe('recencyPenalty', () => {
  it('作ったことがなければ 0', () => {
    expect(recencyPenalty(null, TODAY)).toBe(0);
  });

  it('直近ほど大きい', () => {
    expect(recencyPenalty('2026-08-26T12:00:00.000Z', TODAY)).toBe(1.0);
    expect(recencyPenalty('2026-08-18T12:00:00.000Z', TODAY)).toBe(0.5);
    expect(recencyPenalty('2026-08-05T12:00:00.000Z', TODAY)).toBe(0.2);
    expect(recencyPenalty('2026-01-05T12:00:00.000Z', TODAY)).toBe(0);
  });
});

describe('scoreRecipe — 数量を見ない', () => {
  it('在庫が 1 個でもレシピが 3 個要求していても「ある」扱い（引き算しない）', () => {
    const scored = scoreRecipe(
      recipe({ id: 'r1', ingredients: [{ name: '卵', amount: '3個' }] }),
      [pantry('p1', '卵')],
      {},
      TODAY,
    );
    expect(scored.parts.coverage).toBe(1);
    expect(scored.missingNames).toEqual([]);
  });

  it('coverage の少材料バイアスを useCount と missingCount が打ち消す', () => {
    const stocks = [pantry('p1', '玉ねぎ'), pantry('p2', '人参'), pantry('p3', 'じゃがいも')];
    // 材料 1 個・全部そろう
    const tiny = scoreRecipe(
      recipe({ id: 'tiny', ingredients: [{ name: '玉ねぎ', amount: '1個' }] }),
      stocks,
      {},
      TODAY,
    );
    // 材料 3 個・全部そろう
    const rich = scoreRecipe(
      recipe({
        id: 'rich',
        ingredients: [
          { name: '玉ねぎ', amount: '1個' },
          { name: '人参', amount: '1本' },
          { name: 'じゃがいも', amount: '2個' },
        ],
      }),
      stocks,
      {},
      TODAY,
    );
    expect(rich.score).toBeGreaterThan(tiny.score);
  });

  it('期限は合計しない — 期限品を 2 つ使っても 1 つのときを超えない', () => {
    const one = scoreRecipe(
      recipe({ id: 'a', ingredients: [{ name: 'なす', amount: '1本' }] }),
      [pantry('p1', 'なす', '2026-08-28')],
      {},
      TODAY,
    );
    const two = scoreRecipe(
      recipe({
        id: 'b',
        ingredients: [
          { name: 'なす', amount: '1本' },
          { name: 'トマト', amount: '1個' },
        ],
      }),
      [pantry('p1', 'なす', '2026-08-28'), pantry('p2', 'トマト', '2026-08-28')],
      {},
      TODAY,
    );
    expect(two.parts.expiryUrgency).toBe(one.parts.expiryUrgency);
  });

  it('名寄せ辞書が効く', () => {
    const scored = scoreRecipe(
      recipe({ id: 'r1', ingredients: [{ name: '小麦粉', amount: '100g' }] }),
      [pantry('p1', '春よ恋強力小麦粉')],
      { 春よ恋強力小麦粉: '小麦粉' },
      TODAY,
    );
    expect(scored.parts.coverage).toBe(1);
  });
});

describe('buildMenu — 並べる', () => {
  const stocks = [pantry('egg', '卵'), pantry('nasu', 'なす', '2026-08-29')];

  it('候補が日数より少なければ埋めずに少なく出す', () => {
    const result = buildMenu(
      [recipe({ id: 'r1', ingredients: [{ name: '卵', amount: '2個' }] })],
      stocks,
      7,
      TODAY,
    );
    expect(result.days).toHaveLength(1);
  });

  it('同じレシピを 2 日に置かない', () => {
    const result = buildMenu(
      [
        recipe({ id: 'r1', ingredients: [{ name: '卵', amount: '2個' }] }),
        recipe({ id: 'r2', ingredients: [{ name: 'なす', amount: '1本' }] }),
      ],
      stocks,
      5,
      TODAY,
    );
    const ids = result.days.map((d) => d.recipeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('材料 0 件のレシピは候補にしない', () => {
    const result = buildMenu([recipe({ id: 'empty', ingredients: [] })], stocks, 3, TODAY);
    expect(result.days).toHaveLength(0);
  });

  it('在庫ゼロでも成立する（recency と pinned だけが効く＝しばらく作っていない順）', () => {
    const result = buildMenu(
      [
        recipe({
          id: 'recent',
          ingredients: [{ name: '鶏肉', amount: '200g' }],
          lastCookedAt: '2026-08-27T12:00:00.000Z',
        }),
        recipe({ id: 'old', ingredients: [{ name: '豚肉', amount: '200g' }] }),
      ],
      [],
      2,
      TODAY,
    );
    expect(result.days[0]?.recipeId).toBe('old');
  });

  it('期限が近い在庫を使うレシピが前に来る', () => {
    const result = buildMenu(
      [
        recipe({ id: 'egg-dish', ingredients: [{ name: '卵', amount: '2個' }] }),
        recipe({ id: 'nasu-dish', ingredients: [{ name: 'なす', amount: '1本' }] }),
      ],
      stocks,
      2,
      TODAY,
    );
    expect(result.days[0]?.recipeId).toBe('nasu-dish');
    expect(result.days[0]?.reason).toBe('expiry');
    expect(result.days[0]?.reasonSubject).toBe('なす');
  });
});

describe('buildClaims — 引き当てグラフ', () => {
  const stocks = [pantry('egg', '卵'), pantry('shoyu', '醤油')];
  const recipes = [
    recipe({
      id: 'r1',
      ingredients: [
        { name: '卵', amount: '2個' },
        { name: '醤油', amount: '大さじ1' },
      ],
    }),
    recipe({
      id: 'r2',
      ingredients: [
        { name: '卵', amount: '1個' },
        { name: '醤油', amount: '小さじ2' },
      ],
    }),
  ];

  it('取り分けの調味料は食い合いに数えない', () => {
    const claims = buildClaims(
      [
        { day: 1, recipeId: 'r1' },
        { day: 2, recipeId: 'r2' },
      ],
      recipes,
      stocks,
    );
    expect(claims['egg']).toEqual([1, 2]);
    expect(claims['shoyu']).toBeUndefined();
  });

  it('2 日以上が使う在庫を検出できる（最上段固定の判定）', () => {
    const claims = buildClaims(
      [
        { day: 1, recipeId: 'r1' },
        { day: 2, recipeId: 'r2' },
      ],
      recipes,
      stocks,
    );
    expect(isContested(claims, 'egg')).toBe(true);
    expect(isContested(claims, 'shoyu')).toBe(false);
  });

  it('1 日しか使わない在庫は競合ではない', () => {
    const claims = buildClaims([{ day: 1, recipeId: 'r1' }], recipes, stocks);
    expect(isContested(claims, 'egg')).toBe(false);
  });

  it('日を外すと（作り終わった日）引き当てからも消える', () => {
    const all = buildClaims(
      [
        { day: 1, recipeId: 'r1' },
        { day: 2, recipeId: 'r2' },
      ],
      recipes,
      stocks,
    );
    const afterDone = buildClaims([{ day: 2, recipeId: 'r2' }], recipes, stocks);
    expect(all['egg']).toEqual([1, 2]);
    expect(afterDone['egg']).toEqual([2]);
  });

  it('知らない recipeId は黙って飛ばす（削除されたレシピ）', () => {
    const claims = buildClaims([{ day: 1, recipeId: 'gone' }], recipes, stocks);
    expect(claims).toEqual({});
  });
});

describe('encodeReason / decodeReason — 保存形式の往復', () => {
  it.each([
    ['expiry', 'なす'],
    ['coverage', '6'],
    ['pinned', null],
    ['few-missing', '2'],
    ['ai', '前の日が肉なので魚に'],
  ] as const)('%s は往復する', (kind, subject) => {
    const decoded = decodeReason(encodeReason(kind, subject));
    expect(decoded.kind).toBe(kind);
    expect(decoded.subject).toBe(subject ?? '');
  });

  it('subject に「:」が入っても壊れない（在庫名は自由文）', () => {
    const decoded = decodeReason(encodeReason('expiry', 'A:B'));
    expect(decoded.kind).toBe('expiry');
    expect(decoded.subject).toBe('A:B');
  });

  it('AI の why に「:」が入っても壊れない（自由文の生成テキストのため）', () => {
    const decoded = decodeReason(encodeReason('ai', '朝:昼どちらも肉なので'));
    expect(decoded.kind).toBe('ai');
    expect(decoded.subject).toBe('朝:昼どちらも肉なので');
  });

  it('知らない種別は null に落ちる（画面は理由を出さない）', () => {
    expect(decodeReason('bogus:x').kind).toBeNull();
    expect(decodeReason('').kind).toBeNull();
  });
});

describe('buildArrangeCandidates — M2 に渡す候補（§10.10.4）', () => {
  it('スコア降順（おすすめ順）で並び、cap 件に切り詰める', () => {
    const recipes = [
      recipe({ id: 'low', ingredients: [{ name: 'にんじん', amount: '1本' }] }),
      recipe({
        id: 'high',
        pinnedAt: '2026-08-01T00:00:00.000Z',
        ingredients: [{ name: 'たまご', amount: '2個' }],
      }),
    ];
    const items = [pantry('p1', 'たまご')];
    const candidates = buildArrangeCandidates(recipes, items, {}, TODAY, 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.id).toBe('high'); // ピン留め + 在庫一致でスコアが高い
  });

  it('材料 0 件のレシピは候補にしない（M1 の buildMenu と同じ除外）', () => {
    const recipes = [recipe({ id: 'empty', ingredients: [] })];
    expect(buildArrangeCandidates(recipes, [], {}, TODAY)).toEqual([]);
  });

  it('coveragePct は 0..100 の整数、missing は不足材料名の配列', () => {
    const recipes = [
      recipe({
        id: 'r1',
        ingredients: [
          { name: 'たまご', amount: '2個' },
          { name: '牛乳', amount: '100ml' },
        ],
      }),
    ];
    const items = [pantry('p1', 'たまご')];
    const [candidate] = buildArrangeCandidates(recipes, items, {}, TODAY);
    expect(candidate).toMatchObject({ id: 'r1', coveragePct: 50, missing: ['牛乳'] });
  });
});

describe('applyArrangement — AI の並びを現在の献立へ適用（§10.10.4）', () => {
  const current: ArrangeableDay[] = [
    {
      day: 1,
      recipeId: 'm1',
      title: 'M1のカレー',
      reason: encodeReason('coverage', '4'),
      doneAt: null,
    },
    {
      day: 2,
      recipeId: 'm2',
      title: 'M1の唐揚げ',
      reason: encodeReason('pinned', null),
      doneAt: '2026-08-27T10:00:00.000Z',
    },
  ];
  const candidates = [
    { id: 'a1', title: 'AIの魚の煮付け' },
    { id: 'a2', title: 'AIの豚汁' },
  ];

  it("AI が置いた日だけ差し替える。理由は encodeReason('ai', why) で保存する", () => {
    const next = applyArrangement(
      current,
      [{ day: 1, recipeId: 'a1', why: '魚の日にする' }],
      candidates,
    );
    expect(next[0]).toEqual({
      day: 1,
      recipeId: 'a1',
      title: 'AIの魚の煮付け',
      reason: encodeReason('ai', '魚の日にする'),
      doneAt: null,
    });
  });

  it('X 未満の結果: AI が置かなかった日は M1（前回）のまま触らない', () => {
    const next = applyArrangement(current, [{ day: 1, recipeId: 'a1', why: 'x' }], candidates);
    expect(next[1]).toEqual(current[1]); // day 2 はそのまま。doneAt も維持
  });

  it('差し替えた日は doneAt を null に戻す（新しい献立になった扱い・§10.10.4）', () => {
    const next = applyArrangement(
      current,
      [{ day: 2, recipeId: 'a2', why: '豚汁で温まる' }],
      candidates,
    );
    expect(next[1]?.doneAt).toBeNull();
  });

  it('why が無ければ空文字で保存する（表示側は空を弾く）', () => {
    const next = applyArrangement(current, [{ day: 1, recipeId: 'a1' }], candidates);
    expect(decodeReason(next[0]?.reason ?? '')).toEqual({ kind: 'ai', subject: '' });
  });

  it('候補に無い recipeId は保険として無視する（基本は検証済みの pick しか来ない）', () => {
    const next = applyArrangement(
      current,
      [{ day: 1, recipeId: 'not-a-candidate', why: 'x' }],
      candidates,
    );
    expect(next[0]).toEqual(current[0]);
  });

  it('pick が 1 件も無ければ現在の並びをそのまま返す', () => {
    expect(applyArrangement(current, [], candidates)).toEqual(current);
  });
});
