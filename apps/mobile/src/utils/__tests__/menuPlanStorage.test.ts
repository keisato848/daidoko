/**
 * 献立の保存形（v19・`menu_plans` / `menu_plan_days`）と旧 JSON の互換読み。
 *
 * サービス層（`menu-plan.service.ts`）は drizzle を動的 import するため jest では
 * 実行できない（`docs/品質基準.md` §2.3）。互換の判断はすべてこの純関数側に寄せ、
 * ここで固定する — 旧データ（requestedDays 無し・壊れた値）、未知の時間帯、
 * テーブル行との往復。
 */
import {
  menuPlanRowToStored,
  parseLegacyMenuPlanJson,
  sanitizeMenuMealTime,
  storedMenuPlanToRows,
  type MenuPlanRow,
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
