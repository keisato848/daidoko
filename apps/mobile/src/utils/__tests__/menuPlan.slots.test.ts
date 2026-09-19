import {
  buildMenu,
  fillSlotsFromLibrary,
  mainCandidatePool,
  type MenuPantryItem,
  type MenuRecipe,
} from '../menuPlan';
import type { MenuPlanSlotRow } from '../menuPlanStorage';

/**
 * 主菜以外の枠を蔵書庫から埋める（PR-5a）。守るのは 5 つ:
 * 主菜が取った在庫を副菜が奪わない／同じレシピを 2 枠に入れない／autoFill:false は飛ばす／
 * 候補が無い枠は空のまま／主菜 1 枠の設定では何も起きない（= 既存利用者に影響ゼロ）。
 */
const TODAY = new Date(2026, 8, 19);

function recipe(id: string, title: string, ingredients: string[], tags: string[] = []): MenuRecipe {
  return {
    id,
    title,
    cookTimeMin: null,
    pinnedAt: null,
    lastCookedAt: null,
    ingredients: ingredients.map((name) => ({ name, amount: null })),
    tags,
  };
}

const pantry: MenuPantryItem[] = [
  { id: 'p-tofu', name: '豆腐', expiresOn: null },
  { id: 'p-negi', name: 'ねぎ', expiresOn: null },
  { id: 'p-spinach', name: 'ほうれん草', expiresOn: null },
];

const MAIN_KARAAGE = recipe('r-main', '唐揚げ', ['鶏もも肉', 'にんにく']);
const SOUP_MISO = recipe('r-miso', '味噌汁', ['豆腐', 'ねぎ']);
const SOUP_TONJIRU = recipe('r-tonjiru', '豚汁', ['豚肉', '大根']);
const SIDE_OHITASHI = recipe('r-ohitashi', 'ほうれん草のおひたし', ['ほうれん草']);
const SIDE_HIYAYAKKO = recipe('r-hiyayakko', '冷奴', ['豆腐', 'ねぎ']);

const DEFS = [
  { slotId: 'main', slotKind: 'main' },
  { slotId: 'soup', slotKind: 'soup' },
  { slotId: 'side', slotKind: 'side' },
];

describe('fillSlotsFromLibrary', () => {
  it('種類が当たるレシピで空いている非主菜枠を埋める', () => {
    const out = fillSlotsFromLibrary({
      days: [{ day: 1, recipeId: 'r-main' }],
      slotDefs: DEFS,
      existingSlots: [],
      recipes: [MAIN_KARAAGE, SOUP_MISO, SIDE_OHITASHI],
      pantry,
      today: TODAY,
    });
    expect(out.map((s) => [s.day, s.slotId, s.recipeId])).toEqual([
      [1, 'soup', 'r-miso'],
      [1, 'side', 'r-ohitashi'],
    ]);
    expect(out.every((s) => s.doneAt === null)).toBe(true);
    // 理由は主菜と同じ形（kind:subject）。空文字（手入力の印）にしない
    expect(out.every((s) => s.reason !== '')).toBe(true);
  });

  it('主菜 1 枠の設定では何も置かない（既存利用者に影響ゼロ）', () => {
    const out = fillSlotsFromLibrary({
      days: [{ day: 1, recipeId: 'r-main' }],
      slotDefs: [{ slotId: 'main', slotKind: 'main' }],
      existingSlots: [],
      recipes: [MAIN_KARAAGE, SOUP_MISO],
      pantry,
      today: TODAY,
    });
    expect(out).toEqual([]);
  });

  it('autoFill:false の枠は飛ばす（手入力専用）', () => {
    const out = fillSlotsFromLibrary({
      days: [{ day: 1, recipeId: 'r-main' }],
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'soup', slotKind: 'soup', autoFill: false },
        { slotId: 'side', slotKind: 'side' },
      ],
      existingSlots: [],
      recipes: [SOUP_MISO, SIDE_OHITASHI],
      pantry,
      today: TODAY,
    });
    expect(out.map((s) => s.slotId)).toEqual(['side']);
  });

  it('既に料理が入っている枠は上書きしない（手入力・引き継ぎを守る）', () => {
    const existing: MenuPlanSlotRow[] = [
      {
        day: 1,
        slotId: 'soup',
        recipeId: 'r-manual',
        title: '手入力の汁',
        reason: '',
        doneAt: null,
      },
    ];
    const out = fillSlotsFromLibrary({
      days: [{ day: 1, recipeId: 'r-main' }],
      slotDefs: DEFS,
      existingSlots: existing,
      recipes: [SOUP_MISO, SIDE_OHITASHI],
      pantry,
      today: TODAY,
    });
    expect(out.map((s) => s.slotId)).toEqual(['side']);
  });

  it('候補が無い種類の枠は空のまま（偽の副菜を置かない）', () => {
    const out = fillSlotsFromLibrary({
      days: [{ day: 1, recipeId: 'r-main' }],
      slotDefs: DEFS,
      recipes: [MAIN_KARAAGE, SOUP_MISO], // side の候補が無い
      existingSlots: [],
      pantry,
      today: TODAY,
    });
    expect(out.map((s) => s.slotId)).toEqual(['soup']);
  });

  it('同じレシピを 2 日・2 枠に入れない', () => {
    const out = fillSlotsFromLibrary({
      days: [
        { day: 1, recipeId: 'r-main' },
        { day: 2, recipeId: 'r-main2' },
      ],
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'soup', slotKind: 'soup' },
      ],
      existingSlots: [],
      recipes: [SOUP_MISO], // 汁物は 1 品しか無い
      pantry,
      today: TODAY,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.day).toBe(1);
  });

  it('主菜が取った在庫は副菜の採点で「取られている」扱い（奪い合わない）', () => {
    // 冷奴（豆腐・ねぎ）は在庫が全部揃うので、在庫が空いていれば おひたし より高得点。
    // 主菜が豆腐とねぎを既に取っていれば、冷奴の在庫一致は消え おひたし が勝つ
    const argsBase = {
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'side', slotKind: 'side' },
      ],
      existingSlots: [] as MenuPlanSlotRow[],
      recipes: [SIDE_HIYAYAKKO, SIDE_OHITASHI],
      pantry,
      today: TODAY,
    };
    const free = fillSlotsFromLibrary({ ...argsBase, days: [{ day: 1, recipeId: 'r-main' }] });
    expect(free[0]?.recipeId).toBe('r-hiyayakko');

    const claimed = fillSlotsFromLibrary({
      ...argsBase,
      days: [{ day: 1, recipeId: 'r-main', usesPantryItemIds: ['p-tofu', 'p-negi'] }],
    });
    expect(claimed[0]?.recipeId).toBe('r-ohitashi');
  });

  it('主菜のレシピは副菜候補に回さない（days で使ったものは除外）', () => {
    // 分類上は soup だが主菜として組まれている → 副菜枠に同じ物を置かない
    const out = fillSlotsFromLibrary({
      days: [{ day: 1, recipeId: 'r-miso' }],
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'soup', slotKind: 'soup' },
      ],
      existingSlots: [],
      recipes: [SOUP_MISO, SOUP_TONJIRU],
      pantry,
      today: TODAY,
    });
    expect(out.map((s) => s.recipeId)).toEqual(['r-tonjiru']);
  });

  it('手入力で使われているレシピは、別の日の枠にも置かない', () => {
    const existing: MenuPlanSlotRow[] = [
      { day: 1, slotId: 'soup', recipeId: 'r-miso', title: '味噌汁', reason: '', doneAt: null },
    ];
    const out = fillSlotsFromLibrary({
      days: [
        { day: 1, recipeId: 'r-main' },
        { day: 2, recipeId: 'r-main2' },
      ],
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'soup', slotKind: 'soup' },
      ],
      existingSlots: existing,
      recipes: [SOUP_MISO, SOUP_TONJIRU],
      pantry,
      today: TODAY,
    });
    expect(out.map((s) => [s.day, s.recipeId])).toEqual([[2, 'r-tonjiru']]);
  });

  it('日は番号順に埋める（渡す順に依らない — 候補が足りないとき 1 日目が先）', () => {
    const out = fillSlotsFromLibrary({
      days: [
        { day: 2, recipeId: 'r-main2' },
        { day: 1, recipeId: 'r-main' },
      ],
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'soup', slotKind: 'soup' },
      ],
      existingSlots: [],
      recipes: [SOUP_MISO],
      pantry,
      today: TODAY,
    });
    expect(out.map((s) => s.day)).toEqual([1]);
  });

  it('材料の無いレシピは候補にしない（buildMenu と同じ扱い）', () => {
    const out = fillSlotsFromLibrary({
      days: [{ day: 1, recipeId: 'r-main' }],
      slotDefs: DEFS,
      existingSlots: [],
      recipes: [recipe('r-empty', 'コーンスープ', [])],
      pantry,
      today: TODAY,
    });
    expect(out).toEqual([]);
  });

  it('理由は主菜と同じ kind:subject 形で入る（在庫が全部揃う → coverage）', () => {
    const out = fillSlotsFromLibrary({
      days: [{ day: 1, recipeId: 'r-main' }],
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'soup', slotKind: 'soup' },
      ],
      existingSlots: [],
      recipes: [SOUP_MISO],
      pantry,
      today: TODAY,
    });
    expect(out[0]?.reason).toBe('coverage:2');
  });

  it('onlyDays: 渡した日だけ埋める（ローリングで生き残った日の「外した」枠を戻さない）', () => {
    const out = fillSlotsFromLibrary({
      days: [
        { day: 1, recipeId: 'r-main' },
        { day: 2, recipeId: 'r-main2' },
      ],
      onlyDays: [2],
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'soup', slotKind: 'soup' },
      ],
      existingSlots: [],
      recipes: [SOUP_MISO, SOUP_TONJIRU],
      pantry,
      today: TODAY,
    });
    expect(out.map((s) => s.day)).toEqual([2]);
  });

  it('usesPantryItemIds を持たない日（保存形）は、主菜の材料から在庫の引き当てを引き直す', () => {
    // 主菜が 麻婆豆腐（豆腐・ねぎ）。保存形なので usesPantryItemIds は無い。
    // 引き直さなければ 冷奴（豆腐・ねぎ）が在庫一致で勝つ。引き直せば おひたし が勝つ
    const mabo = recipe('r-mabo', '麻婆豆腐', ['豆腐', 'ねぎ']);
    const out = fillSlotsFromLibrary({
      days: [{ day: 1, recipeId: 'r-mabo' }],
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'side', slotKind: 'side' },
      ],
      existingSlots: [],
      recipes: [mabo, SIDE_HIYAYAKKO, SIDE_OHITASHI],
      pantry,
      today: TODAY,
    });
    expect(out[0]?.recipeId).toBe('r-ohitashi');
  });

  it('同じ slotId が定義に 2 回あっても (day, slotId) は 1 行（PK で「組む」が落ちない）', () => {
    const out = fillSlotsFromLibrary({
      days: [{ day: 1, recipeId: 'r-main' }],
      slotDefs: [
        { slotId: 'soup', slotKind: 'soup' },
        { slotId: 'soup', slotKind: 'soup' },
      ],
      existingSlots: [],
      recipes: [SOUP_MISO, SOUP_TONJIRU],
      pantry,
      today: TODAY,
    });
    expect(out).toHaveLength(1);
  });
});

describe('mainCandidatePool + buildMenu — 主菜が副菜・汁物の候補を先に食わない', () => {
  const ALL = [MAIN_KARAAGE, SOUP_MISO, SIDE_OHITASHI];

  it('在庫が揃った味噌汁を主菜にせず、汁物・副菜の両方が埋まる', () => {
    // 外さなければ 味噌汁（豆腐・ねぎが在庫に全部ある）が主菜の最高点になり、汁物枠が空になる
    const pool = mainCandidatePool({ recipes: ALL, slotDefs: DEFS, excludeIds: [], days: 1 });
    const built = buildMenu(pool, pantry, 1, TODAY);
    expect(built.days[0]?.recipeId).toBe('r-main');
    const out = fillSlotsFromLibrary({
      days: built.days,
      slotDefs: DEFS,
      existingSlots: [],
      recipes: ALL,
      pantry,
      today: TODAY,
    });
    expect(out.map((s) => s.slotId)).toEqual(['soup', 'side']);
  });

  it('主菜 1 枠の設定では何も外さない（既存利用者の主菜の並びは変わらない）', () => {
    const pool = mainCandidatePool({
      recipes: ALL,
      slotDefs: [{ slotId: 'main', slotKind: 'main' }],
      excludeIds: [],
      days: 3,
    });
    expect(pool).toEqual(ALL);
  });

  it('autoFill:false の種類は外さない（その枠は埋めないので、主菜に回してよい）', () => {
    const pool = mainCandidatePool({
      recipes: ALL,
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'soup', slotKind: 'soup', autoFill: false },
      ],
      excludeIds: [],
      days: 1,
    });
    expect(pool.map((r) => r.id)).toContain('r-miso');
  });

  it('外すと日数に足りなくなるなら外さない（蔵書が少ない人の主菜を削らない）', () => {
    const pool = mainCandidatePool({ recipes: ALL, slotDefs: DEFS, excludeIds: [], days: 2 });
    expect(pool).toEqual(ALL);
  });

  it('引き継ぐ手入力のレシピは常に主菜候補から外す（足りなくても重複させない）', () => {
    const pool = mainCandidatePool({
      recipes: ALL,
      slotDefs: DEFS,
      excludeIds: ['r-main'],
      days: 3,
    });
    expect(pool.map((r) => r.id)).not.toContain('r-main');
  });
});
