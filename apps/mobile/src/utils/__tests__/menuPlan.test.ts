/**
 * 献立 M1 の純関数（#215・設計 §10.2〜10.4）。
 *
 * ここで固定するのは**設計の背骨**であって実装の細部ではない:
 * 数量を計算しないこと・取り分けの調味料を食い合いに数えないこと・
 * 埋めないこと・引き当てグラフに順序を付けないこと。
 */
import {
  adoptOrBuildMenuPlan,
  applyArrangement,
  buildArrangeCandidates,
  buildClaims,
  buildMenu,
  decodeReason,
  encodeReason,
  expiryUrgency,
  isContested,
  isServingAmount,
  menuDateKey,
  mergeMissingIngredients,
  recencyPenalty,
  rollMenuPlan,
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

describe('menuDateKey', () => {
  it('YYYY-MM-DD（ローカル日付）を返す', () => {
    expect(menuDateKey(TODAY)).toBe('2026-08-28');
    expect(menuDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('rollMenuPlan — 起動時の鮮度判定＋ローリング（§10.11.1）', () => {
  const recipes = [
    recipe({ id: 'r1', ingredients: [{ name: '卵', amount: '2個' }] }),
    recipe({ id: 'r2', ingredients: [{ name: 'なす', amount: '1本' }] }),
    recipe({ id: 'r3', ingredients: [{ name: '鶏肉', amount: '200g' }] }),
    recipe({ id: 'r4', ingredients: [{ name: '豚肉', amount: '200g' }] }),
  ];
  const stocks = [
    pantry('egg', '卵'),
    pantry('nasu', 'なす'),
    pantry('tori', '鶏肉'),
    pantry('buta', '豚肉'),
  ];

  it('anchorDate が無い（手動プラン）なら何もしない', () => {
    expect(rollMenuPlan({ anchorDate: null, days: [] }, TODAY, recipes, stocks)).toBeNull();
  });

  it('経過日が 0 以下（今日すでに鮮度が合っている）なら何もしない', () => {
    const plan = {
      anchorDate: '2026-08-28',
      days: [{ day: 1, recipeId: 'r1', title: 'r1', reason: 'coverage:1', doneAt: null }],
    };
    expect(rollMenuPlan(plan, TODAY, recipes, stocks)).toBeNull();
  });

  it('経過日ぶん先頭を落とし、生き残った日の中身は一切変えない（日番号だけ振り直す）', () => {
    const plan = {
      anchorDate: '2026-08-27', // 1 日経過
      days: [
        {
          day: 1,
          recipeId: 'r1',
          title: 'r1',
          reason: encodeReason('coverage', '1'),
          doneAt: null,
        },
        {
          day: 2,
          recipeId: 'r2',
          title: 'r2',
          reason: encodeReason('pinned', null),
          doneAt: '2026-08-20T00:00:00.000Z',
        },
        {
          day: 3,
          recipeId: 'r3',
          title: 'r3',
          reason: encodeReason('few-missing', '2'),
          doneAt: null,
        },
      ],
    };
    const result = rollMenuPlan(plan, TODAY, recipes, stocks);
    expect(result).not.toBeNull();
    // 昨日の Day2（r2）が今日の Day1 になる。reason・doneAt はそのまま
    expect(result?.days[0]).toEqual({
      day: 1,
      recipeId: 'r2',
      title: 'r2',
      reason: encodeReason('pinned', null),
      doneAt: '2026-08-20T00:00:00.000Z',
    });
    expect(result?.days[1]).toEqual({
      day: 2,
      recipeId: 'r3',
      title: 'r3',
      reason: encodeReason('few-missing', '2'),
      doneAt: null,
    });
    // 末尾に 1 日だけ補充。使用済み（r1/r2/r3）は再登場しない → 残る候補は r4 だけ
    expect(result?.days).toHaveLength(3);
    expect(result?.days[2]?.recipeId).toBe('r4');
    expect(result?.days[2]?.day).toBe(3);
    expect(result?.days[2]?.doneAt).toBeNull();
    expect(result?.anchorDate).toBe('2026-08-28');
  });

  it('補充した日だけを addedDays として返す（自動追加の対象は末尾だけ・毎日高々数品）', () => {
    const plan = {
      anchorDate: '2026-08-27',
      days: [
        { day: 1, recipeId: 'r1', title: 'r1', reason: 'coverage:1', doneAt: null },
        { day: 2, recipeId: 'r2', title: 'r2', reason: 'coverage:1', doneAt: null },
        { day: 3, recipeId: 'r3', title: 'r3', reason: 'coverage:1', doneAt: null },
      ],
    };
    const result = rollMenuPlan(plan, TODAY, recipes, stocks);
    expect(result?.addedDays).toHaveLength(1);
    expect(result?.addedDays[0]?.recipeId).toBe('r4');
    // 生存日は addedDays に含まれない
    expect(result?.addedDays.some((d) => d.recipeId === 'r2' || d.recipeId === 'r3')).toBe(false);
  });

  it('長く空けていても X 日を超えて足さない（候補が尽きたら埋めない）', () => {
    const plan = {
      anchorDate: '2026-08-01', // 27 日経過 — X=3 をはるかに超える
      days: [
        { day: 1, recipeId: 'r1', title: 'r1', reason: 'coverage:1', doneAt: null },
        { day: 2, recipeId: 'r2', title: 'r2', reason: 'coverage:1', doneAt: null },
        { day: 3, recipeId: 'r3', title: 'r3', reason: 'coverage:1', doneAt: null },
      ],
    };
    const result = rollMenuPlan(plan, TODAY, recipes, stocks);
    // 生存日ゼロ。使用済み r1/r2/r3 を除くと候補は r4 の 1 件だけなので、
    // 3 日ぶん補充しようとしても 1 日で候補が尽きて止まる（埋めない・§10.3 と同じ退化）
    expect(result?.days).toHaveLength(1);
    expect(result?.days[0]?.recipeId).toBe('r4');
    expect(result?.addedDays).toHaveLength(1);
  });

  // 修正1: targetDays を plan.days.length に固定していたため、初回生成後は
  // 日数設定を変えても常に元の日数に戻ってしまっていた（#215 レビュー指摘）。
  it('日数設定を増やすと、経過日が無くてもこの回で末尾に追加し、増えた分だけ addedDays に入る（3→5）', () => {
    // 「長く空けていても…」テストの候補枯渇を壊さないよう、独立した候補一式を使う
    const growRecipes = [
      recipe({ id: 'g1', ingredients: [{ name: '卵', amount: '2個' }] }),
      recipe({ id: 'g2', ingredients: [{ name: 'なす', amount: '1本' }] }),
      recipe({ id: 'g3', ingredients: [{ name: '鶏肉', amount: '200g' }] }),
      recipe({ id: 'g4', ingredients: [{ name: '豚肉', amount: '200g' }] }),
      recipe({ id: 'g5', ingredients: [{ name: '大根', amount: '半分' }] }),
    ];
    const growStocks = [
      pantry('egg', '卵'),
      pantry('nasu', 'なす'),
      pantry('tori', '鶏肉'),
      pantry('buta', '豚肉'),
      pantry('daikon', '大根'),
    ];
    const plan = {
      anchorDate: '2026-08-28', // 経過日 0（今日のうちに日数設定を変えた想定）
      days: [
        { day: 1, recipeId: 'g1', title: 'g1', reason: 'coverage:1', doneAt: null },
        { day: 2, recipeId: 'g2', title: 'g2', reason: 'coverage:1', doneAt: null },
        { day: 3, recipeId: 'g3', title: 'g3', reason: 'coverage:1', doneAt: null },
      ],
    };
    const result = rollMenuPlan(plan, TODAY, growRecipes, growStocks, {}, 5);
    expect(result).not.toBeNull();
    // 生存する 3 日は中身も番号も一切変わらない
    expect(result?.days.slice(0, 3)).toEqual(plan.days);
    expect(result?.days).toHaveLength(5);
    // 増えた 2 日だけが addedDays に入る（自動追加の対象もここだけ）
    expect(result?.addedDays).toHaveLength(2);
    expect(result?.addedDays.map((d) => d.recipeId)).toEqual(['g4', 'g5']);
  });

  it('日数設定を減らすと、経過日が無くてもこの回で末尾から間引き、addedDays は空になる（5→3）', () => {
    const plan = {
      anchorDate: '2026-08-28', // 経過日 0
      days: [
        { day: 1, recipeId: 'r1', title: 'r1', reason: 'coverage:1', doneAt: null },
        { day: 2, recipeId: 'r2', title: 'r2', reason: 'coverage:1', doneAt: null },
        { day: 3, recipeId: 'r3', title: 'r3', reason: 'coverage:1', doneAt: null },
        { day: 4, recipeId: 'r4', title: 'r4', reason: 'coverage:1', doneAt: null },
        { day: 5, recipeId: 'r5', title: 'r5', reason: 'coverage:1', doneAt: null },
      ],
    };
    const result = rollMenuPlan(plan, TODAY, recipes, stocks, {}, 3);
    expect(result).not.toBeNull();
    // 末尾の 2 日（Day4・Day5）が消える。残った 3 日の中身は一切変わらない
    expect(result?.days).toEqual(plan.days.slice(0, 3));
    // 間引いただけ——買い物リストの行には一切触らない（自動で消すことは一切しない）
    expect(result?.addedDays).toEqual([]);
  });
});

describe('adoptOrBuildMenuPlan — 自動モード有効化の瞬間の決定（§10.11.1・修正2）', () => {
  const recipes = [
    recipe({ id: 'r1', ingredients: [{ name: '卵', amount: '2個' }] }),
    recipe({ id: 'r2', ingredients: [{ name: 'なす', amount: '1本' }] }),
  ];
  const stocks = [pantry('egg', '卵'), pantry('nasu', 'なす')];

  it('プランが 1 つも無いときだけ M1 で新規に組む', () => {
    const result = adoptOrBuildMenuPlan(null, recipes, stocks, 2, TODAY);
    expect(result.anchorDate).toBe('2026-08-28');
    expect(result.days).toHaveLength(2);
    expect(result.addedDays).toEqual([]);
  });

  it('anchorDate 無しの既存プランには anchorDate が立つだけで、days は変わらない', () => {
    const existingDays = [
      { day: 1, recipeId: 'r9', title: '手動で選んだ一品', reason: 'ai:', doneAt: null },
      {
        day: 2,
        recipeId: 'r8',
        title: '作った日もある一品',
        reason: 'coverage:1',
        doneAt: '2026-08-20T00:00:00.000Z',
      },
    ];
    const result = adoptOrBuildMenuPlan({ days: existingDays }, recipes, stocks, 2, TODAY);
    expect(result.anchorDate).toBe('2026-08-28');
    // 既存プラン（手動/AI とも）は破棄しない。中身は一切変えない
    expect(result.days).toEqual(existingDays);
  });

  it('有効化初回の addedDays は常に空（プランの有無どちらでもこの回の自動追加はしない）', () => {
    const fromScratch = adoptOrBuildMenuPlan(null, recipes, stocks, 2, TODAY);
    const fromExisting = adoptOrBuildMenuPlan(
      { days: [{ day: 1, recipeId: 'r1', title: 'r1', reason: 'coverage:1', doneAt: null }] },
      recipes,
      stocks,
      2,
      TODAY,
    );
    expect(fromScratch.addedDays).toEqual([]);
    expect(fromExisting.addedDays).toEqual([]);
  });
});

describe('mergeMissingIngredients — 複数日の不足材料を 1 行へまとめる（§10.4・§10.11.2）', () => {
  const recipes = [
    recipe({
      id: 'd1',
      ingredients: [
        { name: '玉ねぎ', amount: '1個' },
        { name: '卵', amount: '2個' },
      ],
    }),
    recipe({
      id: 'd2',
      ingredients: [
        { name: '玉ねぎ', amount: '半分' },
        { name: '醤油', amount: '大さじ1' },
      ],
    }),
  ];
  const stocks = [pantry('egg', '卵')]; // 卵だけ在庫にある

  it('在庫にある材料は除外し、同名は日ごとの分量を配列でまとめる', () => {
    const result = mergeMissingIngredients(
      [{ recipeId: 'd1' }, { recipeId: 'd2' }],
      recipes,
      stocks,
    );
    const byName = new Map(result.map((r) => [r.name, r]));
    expect(byName.has('卵')).toBe(false); // 在庫にある
    expect(byName.get('玉ねぎ')).toEqual({
      name: '玉ねぎ',
      amounts: ['1個', '半分'],
      recipeId: 'd1',
    });
    expect(byName.get('醤油')).toEqual({ name: '醤油', amounts: ['大さじ1'], recipeId: 'd2' });
  });

  it('由来レシピは最初にその材料を要求した日のもの（バッジのタップ先）', () => {
    const result = mergeMissingIngredients(
      [{ recipeId: 'd2' }, { recipeId: 'd1' }],
      recipes,
      stocks,
    );
    const onion = result.find((r) => r.name === '玉ねぎ');
    expect(onion?.recipeId).toBe('d2'); // d2 を先に渡したので d2 が由来
  });

  it('知らない recipeId は黙って飛ばす（削除されたレシピの日）', () => {
    expect(mergeMissingIngredients([{ recipeId: 'gone' }], recipes, stocks)).toEqual([]);
  });

  it('名寄せ辞書は在庫の突合だけに使う（まとめる鍵は素の名前）', () => {
    const withAlias = [
      recipe({ id: 'e1', ingredients: [{ name: '強力粉', amount: '100g' }] }),
      recipe({ id: 'e2', ingredients: [{ name: '薄力粉', amount: '50g' }] }),
    ];
    // 「強力粉」が辞書で「小麦粉」の在庫と一致 → 在庫あり扱いで除外される
    const result = mergeMissingIngredients(
      [{ recipeId: 'e1' }, { recipeId: 'e2' }],
      withAlias,
      [pantry('flour', '小麦粉')],
      { 強力粉: '小麦粉' },
    );
    // 強力粉は在庫扱いで消え、薄力粉（辞書に無い）は別行のまま残る
    expect(result).toEqual([{ name: '薄力粉', amounts: ['50g'], recipeId: 'e2' }]);
  });
});
