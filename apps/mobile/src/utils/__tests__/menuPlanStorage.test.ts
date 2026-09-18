/**
 * 献立の保存形（v19・`menu_plans` / `menu_plan_days`）と旧 JSON の互換読み。
 *
 * サービス層（`menu-plan.service.ts`）は drizzle を動的 import するため jest では
 * 実行できない（`docs/品質基準.md` §2.3）。互換の判断はすべてこの純関数側に寄せ、
 * ここで固定する — 旧データ（requestedDays 無し・壊れた値）、未知の時間帯、
 * テーブル行との往復。
 */
import {
  applyDaysToSlots,
  mainSlotsToDays,
  removeSlotEntry,
  rollMenuPlanSlots,
  upsertSlotEntry,
  menuPlanRowToStored,
  parseLegacyMenuPlanJson,
  sanitizeMenuMealTime,
  storedMenuPlanToRows,
  legacyPlanDaysToSlots,
  type MenuPlanRow,
  type MenuPlanDayRow,
  type MenuPlanSlotRow,
  type StoredMenuPlan,
} from '../menuPlanStorage';

const basePlanJson = {
  version: 1,
  generatedAt: '2026-09-05T00:00:00.000Z',
  source: 'coverage',
  pantrySignature: 'sig',
  days: [
    { day: 1, recipeId: 'r1', title: '肉じゃが', reason: 'coverage:3', doneAt: null },
    { day: 2, recipeId: 'r2', title: '麻婆豆腐', reason: '', doneAt: '2026-09-05T10:00:00.000Z' },
  ],
};

describe('sanitizeMenuMealTime — 未知の値は夕として読む', () => {
  it('朝・昼はそのまま', () => {
    expect(sanitizeMenuMealTime('breakfast')).toBe('breakfast');
    expect(sanitizeMenuMealTime('lunch')).toBe('lunch');
  });

  it.each(['dinner', 'brunch', '', null, undefined, 3])('%p は dinner', (value) => {
    expect(sanitizeMenuMealTime(value)).toBe('dinner');
  });
});

describe('parseLegacyMenuPlanJson — 旧 app_meta JSON の取り込み', () => {
  it('旧 JSON は時間帯を持たない = 夕として読む', () => {
    const plan = parseLegacyMenuPlanJson(JSON.stringify(basePlanJson));
    expect(plan?.mealTime).toBe('dinner');
    expect(plan?.days).toHaveLength(2);
    expect(plan?.days[0]).toEqual({
      day: 1,
      recipeId: 'r1',
      title: '肉じゃが',
      reason: 'coverage:3',
      doneAt: null,
    });
  });

  it('requestedDays が保存されていれば読める', () => {
    const plan = parseLegacyMenuPlanJson(JSON.stringify({ ...basePlanJson, requestedDays: 3 }));
    expect(plan?.requestedDays).toBe(3);
  });

  it('旧データ（requestedDays 無し）はプロパティ無しのまま読める（不足の表示は出ない）', () => {
    const plan = parseLegacyMenuPlanJson(JSON.stringify(basePlanJson));
    expect(plan).not.toBeNull();
    expect(plan && 'requestedDays' in plan).toBe(false);
  });

  it.each(['3', 0, -1, 2.5, null])('壊れた requestedDays（%p）は落として読む', (bad) => {
    const plan = parseLegacyMenuPlanJson(JSON.stringify({ ...basePlanJson, requestedDays: bad }));
    expect(plan).not.toBeNull();
    expect(plan?.requestedDays).toBeUndefined();
  });

  it('anchorDate・aiNote・autoAddedItemIds を写す（自動モードのプランの引き継ぎ）', () => {
    const plan = parseLegacyMenuPlanJson(
      JSON.stringify({
        ...basePlanJson,
        source: 'ai',
        anchorDate: '2026-09-05',
        aiNote: '一言',
        autoAddedItemIds: ['a', 'b'],
      }),
    );
    expect(plan?.source).toBe('ai');
    expect(plan?.anchorDate).toBe('2026-09-05');
    expect(plan?.aiNote).toBe('一言');
    expect(plan?.autoAddedItemIds).toEqual(['a', 'b']);
  });

  it('autoAddedItemIds に文字列でないものが混ざっても落ちない', () => {
    const plan = parseLegacyMenuPlanJson(
      JSON.stringify({ ...basePlanJson, autoAddedItemIds: ['a', 42, null] }),
    );
    expect(plan?.autoAddedItemIds).toEqual(['a']);
  });

  it.each(['', 'not json', 'null', '[]', '{}'])('壊れた入力「%s」は null', (raw) => {
    expect(parseLegacyMenuPlanJson(raw)).toBeNull();
  });

  it('壊れた日（recipeId 無し等）は捨てて読む', () => {
    const plan = parseLegacyMenuPlanJson(
      JSON.stringify({
        ...basePlanJson,
        days: [{ day: 1, title: 'recipeId 無し' }, basePlanJson.days[0], 42],
      }),
    );
    expect(plan?.days).toHaveLength(1);
    expect(plan?.days[0].recipeId).toBe('r1');
  });
});

describe('menuPlanRowToStored / storedMenuPlanToRows — テーブル行との往復', () => {
  const fullPlan: StoredMenuPlan = {
    version: 1,
    mealTime: 'lunch',
    generatedAt: '2026-09-05T00:00:00.000Z',
    source: 'ai',
    pantrySignature: 'sig',
    days: [
      { day: 1, recipeId: 'r1', title: '肉じゃが', reason: 'coverage:3', doneAt: null },
      { day: 2, recipeId: 'r2', title: '麻婆豆腐', reason: '', doneAt: '2026-09-05T10:00:00Z' },
    ],
    aiNote: '一言',
    anchorDate: '2026-09-05',
    requestedDays: 3,
    autoAddedItemIds: ['a', 'b'],
  };

  const minimalPlan: StoredMenuPlan = {
    version: 1,
    mealTime: 'dinner',
    generatedAt: '2026-09-05T00:00:00.000Z',
    source: 'coverage',
    pantrySignature: 'sig',
    days: [],
  };

  it.each([
    ['全フィールドあり', fullPlan],
    ['省略可フィールド無し', minimalPlan],
  ])('%s のプランが往復する', (_label, plan) => {
    const { row, days } = storedMenuPlanToRows(plan, 'plan-1');
    expect(menuPlanRowToStored(row, days)).toEqual(plan);
  });

  it('省略可フィールド無しは NULL 列になる（undefined を文字列化しない）', () => {
    const { row } = storedMenuPlanToRows(minimalPlan, 'plan-1');
    expect(row.anchorDate).toBeNull();
    expect(row.requestedDays).toBeNull();
    expect(row.aiNote).toBeNull();
    expect(row.autoAddedItemIds).toBeNull();
  });

  it('未知の meal_time は夕として読む（前方互換 — 将来の値を描き間違えない）', () => {
    const { row, days } = storedMenuPlanToRows(minimalPlan, 'plan-1');
    const stored = menuPlanRowToStored({ ...row, mealTime: 'brunch' }, days);
    expect(stored.mealTime).toBe('dinner');
  });

  it('壊れた requested_days・auto_added_item_ids は「無い」として読む', () => {
    const { row, days } = storedMenuPlanToRows(minimalPlan, 'plan-1');
    const stored = menuPlanRowToStored(
      { ...row, requestedDays: 0, autoAddedItemIds: 'not json' } as MenuPlanRow,
      days,
    );
    expect('requestedDays' in stored).toBe(false);
    expect('autoAddedItemIds' in stored).toBe(false);
  });

  it('日は day 昇順に並べ直して読む（挿入順に依存しない）', () => {
    const { row } = storedMenuPlanToRows(fullPlan, 'plan-1');
    const stored = menuPlanRowToStored(row, [
      { day: 2, recipeId: 'r2', title: 'b', reason: '', doneAt: null },
      { day: 1, recipeId: 'r1', title: 'a', reason: '', doneAt: null },
    ]);
    expect(stored.days.map((d) => d.day)).toEqual([1, 2]);
  });
});

describe('legacyPlanDaysToSlots — 旧 `menu_plan_days` の枠対応', () => {
  it('空配列を渡すと空配列が返る', () => {
    expect(legacyPlanDaysToSlots([])).toEqual([]);
  });

  it("旧形式の行配列を渡すと、全行に slotId: 'main' が付いた新形式になる", () => {
    const days: MenuPlanDayRow[] = [
      { day: 1, recipeId: 'r1', title: '肉じゃが', reason: 'coverage', doneAt: null },
      { day: 2, recipeId: 'r2', title: '麻婆豆腐', reason: '', doneAt: '2026-09-05T10:00:00Z' },
    ];
    const expected = [
      {
        day: 1,
        slotId: 'main',
        recipeId: 'r1',
        title: '肉じゃが',
        reason: 'coverage',
        doneAt: null,
      },
      {
        day: 2,
        slotId: 'main',
        recipeId: 'r2',
        title: '麻婆豆腐',
        reason: '',
        doneAt: '2026-09-05T10:00:00Z',
      },
    ];
    expect(legacyPlanDaysToSlots(days)).toEqual(expected);
  });
});

describe('mainSlotsToDays / applyDaysToSlots — 枠と「1 日 1 品」の相互変換', () => {
  const mainDay1: MenuPlanSlotRow = {
    day: 1,
    slotId: 'main',
    recipeId: 'r1',
    title: '肉じゃが',
    reason: 'coverage',
    doneAt: null,
  };
  const sideDay1: MenuPlanSlotRow = {
    day: 1,
    slotId: 'side',
    recipeId: 'r9',
    title: 'ほうれん草のおひたし',
    reason: '',
    doneAt: null,
  };

  it('主菜だけを取り出して日の形に戻す', () => {
    expect(mainSlotsToDays([mainDay1, sideDay1])).toEqual([
      { day: 1, recipeId: 'r1', title: '肉じゃが', reason: 'coverage', doneAt: null },
    ]);
  });

  it('主菜が無い枠だけなら空配列（副菜を主菜として描かない）', () => {
    expect(mainSlotsToDays([sideDay1])).toEqual([]);
  });

  it('days を写しても副菜は残る（保存のたびに副菜が消えない）', () => {
    const days: MenuPlanDayRow[] = [
      { day: 1, recipeId: 'r1', title: '肉じゃが', reason: 'coverage', doneAt: 'done' },
    ];
    const next = applyDaysToSlots(days, [mainDay1, sideDay1]);
    expect(next).toContainEqual(sideDay1);
    expect(next).toContainEqual({ ...mainDay1, doneAt: 'done' });
    expect(next).toHaveLength(2);
  });

  it('days から消えた日の主菜は消える', () => {
    const next = applyDaysToSlots([], [mainDay1, sideDay1]);
    expect(next).toEqual([sideDay1]);
  });
});

describe('upsertSlotEntry / removeSlotEntry — 枠に手で料理を入れる（PR-4）', () => {
  const main1: MenuPlanSlotRow = {
    day: 1,
    slotId: 'main',
    recipeId: 'r1',
    title: '肉じゃが',
    reason: 'coverage',
    doneAt: '2026-09-18T10:00:00.000Z',
  };
  const side1: MenuPlanSlotRow = {
    day: 1,
    slotId: 'side',
    recipeId: 'r9',
    title: 'おひたし',
    reason: '',
    doneAt: null,
  };

  it('空いている枠に入れる', () => {
    const next = upsertSlotEntry([main1], {
      day: 2,
      slotId: 'side',
      recipeId: 'r5',
      title: '豚汁',
    });
    expect(next).toContainEqual({
      day: 2,
      slotId: 'side',
      recipeId: 'r5',
      title: '豚汁',
      reason: '',
      doneAt: null,
    });
    expect(next).toHaveLength(2);
  });

  it('埋まっている枠は置き換える（重複させない）', () => {
    const next = upsertSlotEntry([main1, side1], {
      day: 1,
      slotId: 'side',
      recipeId: 'r7',
      title: '冷奴',
    });
    expect(next.filter((s) => s.day === 1 && s.slotId === 'side')).toHaveLength(1);
    expect(next.find((s) => s.slotId === 'side')?.title).toBe('冷奴');
  });

  it('**置き換えたら doneAt を引き継がない**（作っていない物が済みにならない）', () => {
    const next = upsertSlotEntry([main1], {
      day: 1,
      slotId: 'main',
      recipeId: 'r2',
      title: '麻婆豆腐',
    });
    expect(next.find((s) => s.slotId === 'main')?.doneAt).toBeNull();
  });

  it('他の日・他の枠は触らない', () => {
    const next = upsertSlotEntry([main1, side1], {
      day: 1,
      slotId: 'soup',
      recipeId: 'r3',
      title: 'みそ汁',
    });
    expect(next).toContainEqual(main1);
    expect(next).toContainEqual(side1);
  });

  it('外すとその枠だけ消える', () => {
    expect(removeSlotEntry([main1, side1], 1, 'side')).toEqual([main1]);
  });

  it('無い枠を外しても何も起きない', () => {
    expect(removeSlotEntry([main1], 1, 'soup')).toEqual([main1]);
  });
});

describe('rollMenuPlanSlots — 自動モードのローリングで枠も同じだけ詰める', () => {
  const slots: MenuPlanSlotRow[] = [
    { day: 1, slotId: 'side', recipeId: 'a', title: '1日目の副菜', reason: '', doneAt: null },
    { day: 2, slotId: 'side', recipeId: 'b', title: '2日目の副菜', reason: '', doneAt: null },
    { day: 3, slotId: 'side', recipeId: 'c', title: '3日目の副菜', reason: '', doneAt: null },
  ];

  it('落ちた日の枠は捨て、残りの日番号を詰める', () => {
    expect(rollMenuPlanSlots(slots, 1)).toEqual([
      { day: 1, slotId: 'side', recipeId: 'b', title: '2日目の副菜', reason: '', doneAt: null },
      { day: 2, slotId: 'side', recipeId: 'c', title: '3日目の副菜', reason: '', doneAt: null },
    ]);
  });

  it('経過日が無ければそのまま（生き残った日は触らない・§10.11.1）', () => {
    expect(rollMenuPlanSlots(slots, 0)).toEqual(slots);
  });

  it('全部落ちたら空になる（旧い副菜を day 1 に残さない）', () => {
    expect(rollMenuPlanSlots(slots, 3)).toEqual([]);
  });
});

describe('menuPlanRowToStored / storedMenuPlanToRows — 枠つきの往復（v20）', () => {
  const planWithSlots: StoredMenuPlan = {
    version: 1,
    mealTime: 'dinner',
    generatedAt: '2026-09-05T00:00:00.000Z',
    source: 'coverage',
    pantrySignature: 'sig',
    days: [{ day: 1, recipeId: 'r1', title: '肉じゃが', reason: 'coverage', doneAt: null }],
    slots: [
      {
        day: 1,
        slotId: 'main',
        recipeId: 'r1',
        title: '肉じゃが',
        reason: 'coverage',
        doneAt: null,
      },
      { day: 1, slotId: 'side', recipeId: 'r9', title: 'おひたし', reason: '', doneAt: null },
    ],
  };

  it('枠つきのプランが往復する', () => {
    const { row, days, slots } = storedMenuPlanToRows(planWithSlots, 'plan-1');
    expect(menuPlanRowToStored(row, days, slots)).toEqual(planWithSlots);
  });

  it('枠があれば days は主菜枠から作る（旧 menu_plan_days が古くても引きずられない）', () => {
    const { row, slots } = storedMenuPlanToRows(planWithSlots, 'plan-1');
    const staleDays: MenuPlanDayRow[] = [
      { day: 1, recipeId: 'OLD', title: '前の献立', reason: '', doneAt: null },
    ];
    expect(menuPlanRowToStored(row, staleDays, slots).days).toEqual(planWithSlots.days);
  });

  it('枠が無ければ従来どおり menu_plan_days から読む（v19 のデータ）', () => {
    const { row } = storedMenuPlanToRows(planWithSlots, 'plan-1');
    const legacyDays: MenuPlanDayRow[] = [
      { day: 1, recipeId: 'r1', title: '肉じゃが', reason: 'coverage', doneAt: null },
    ];
    const stored = menuPlanRowToStored(row, legacyDays);
    expect(stored.days).toEqual(legacyDays);
    expect('slots' in stored).toBe(false);
  });

  it('枠を持たないプランを書くと、主菜だけの枠が出る（新規プランも枠を持つ）', () => {
    const { slots } = storedMenuPlanToRows({ ...planWithSlots, slots: undefined }, 'plan-1');
    expect(slots).toEqual([
      {
        day: 1,
        slotId: 'main',
        recipeId: 'r1',
        title: '肉じゃが',
        reason: 'coverage',
        doneAt: null,
      },
    ]);
  });
});
