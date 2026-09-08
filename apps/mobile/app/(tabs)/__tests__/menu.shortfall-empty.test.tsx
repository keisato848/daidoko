/**
 * S20 献立 — 蔵書 0 件でも一括生成に到達できる（設計 §10.12.2・2026-09-08 の不具合）。
 *
 * 「1 日も組めなかった」ときだけ空状態へ落ち、押せるのが 1 品ずつの相談だけになっていた。
 * M3（§10.12）の動機はコールドスタートを解くことなので、**不足日数が最大のこの場面こそ**
 * 「足りない◯日分をまとめて作る」が要る。塞いでいたのは `shortfall` を `hasPlan` で
 * 絞っていた描画の分岐 1 か所で、下流（generateMenuPlan / runBulkGenerate）は 0 日でも動く。
 *
 * このテストは「0 日のプランでバナーが出る」ことと「そこから一括生成が実際に走る」ことを
 * 見る。`hasPlan` 条件を戻すと 2 つとも赤くなる。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import MenuScreen from '../menu';
import { t, tCount } from '../../../src/i18n';
import type { MenuPlanView } from '../../../src/services/menu-plan.service';

const mockGetMenuPlan = jest.fn();
const mockGenerateMenuRecipes = jest.fn();
const mockEnsureInferenceCredit = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));

// requireActual は使わない — 実体が expo-sqlite / drizzle を引き込み、
// 最初の 1 本だけモジュール初期化に数秒取られて waitFor が落ちる（他は緑のまま = 見落としやすい）
jest.mock('../../../src/services/menu-plan.service', () => ({
  MENU_MEAL_TIMES: ['breakfast', 'lunch', 'dinner'],
  getMenuPlan: (...args: unknown[]) => mockGetMenuPlan(...(args as [])),
  getStoredMealTimes: jest.fn(async () => []),
  generateMenuPlan: jest.fn(async () => null),
  buildMenuBulkContext: jest.fn(async () => ({ existingTitles: [], pantryNames: [] })),
  buildMenuArrangeContext: jest.fn(async () => null),
  buildMenuShoppingPlan: jest.fn(async () => []),
  addMenuShoppingRows: jest.fn(async () => 0),
  applyMenuArrangement: jest.fn(async () => null),
  fillMenuPlanShortfall: jest.fn(async () => null),
  replaceMenuDay: jest.fn(async () => ({ outcome: 'no-candidates' })),
  undoMenuAutoAddedItems: jest.fn(async () => undefined),
}));

jest.mock('../../../src/services/menu-recipes.provider', () => ({
  // menu.tsx は同じモジュールから受け取るので instanceof は一致する
  MenuRecipesError: class MenuRecipesError extends Error {},
  generateMenuRecipes: (...args: unknown[]) => mockGenerateMenuRecipes(...(args as [])),
}));

jest.mock('../../../src/services/menu-arrange.provider', () => ({
  MenuArrangeError: class MenuArrangeError extends Error {},
  arrangeMenu: jest.fn(async () => null),
}));

jest.mock('../../../src/services/inference-gate.service', () => ({
  ensureInferenceCredit: (...args: unknown[]) => mockEnsureInferenceCredit(...(args as [])),
}));

jest.mock('../../../src/services/app-meta.service', () => ({
  getMenuTasteMemo: jest.fn(async () => null),
}));

jest.mock('../../../src/services/usage.service', () => ({
  FREE_MONTHLY_LIMIT: 5,
  recordCloudInference: jest.fn(async () => undefined),
}));

jest.mock('../../../src/services/recipe.service', () => ({
  createRecipe: jest.fn(async () => 'r-new'),
}));

/** 「7 日分を要求したが 1 日も組めなかった」= レシピ 0 件のプラン */
const emptyPlanView = (requestedDays: number): MenuPlanView =>
  ({
    plan: {
      version: 1,
      mealTime: 'dinner',
      generatedAt: '2026-09-08T09:00:00.000Z',
      source: 'coverage',
      pantrySignature: '',
      requestedDays,
      days: [],
    },
    days: [],
    stale: false,
  }) as unknown as MenuPlanView;

describe('S20 献立 — レシピ 0 件からの一括生成（§10.12.2）', () => {
  beforeEach(() => {
    mockGetMenuPlan.mockReset().mockResolvedValue(emptyPlanView(7));
    mockGenerateMenuRecipes.mockReset().mockResolvedValue([]);
    mockEnsureInferenceCredit.mockReset().mockResolvedValue('ready');
    mockPush.mockReset();
  });

  it('1 日も組めなかったプランでも「足りない◯日分をまとめて作る」を出す', async () => {
    render(<MenuScreen />);

    await waitFor(() =>
      expect(screen.getByText(tCount('menu.shortfall.bulkGenerate', 7))).toBeTruthy(),
    );
    // 不足日数は要求日数そのもの（0 日組めた = 7 日分足りない）
    expect(screen.getByText(tCount('menu.shortfall.banner', 7))).toBeTruthy();
  });

  it('行き止まりの文言（「先に何品か登録してください」）を出さない', async () => {
    render(<MenuScreen />);

    await waitFor(() =>
      expect(screen.getByText(tCount('menu.shortfall.bulkGenerate', 7))).toBeTruthy(),
    );
    expect(screen.queryByText(t('menu.emptyDays.noRecipes'))).toBeNull();
    expect(screen.getByText(t('menu.emptyDays.noRecipesBulk'))).toBeTruthy();
  });

  it('1 品ずつ相談する道は残す（M3 は提案であって唯一の入口ではない）', async () => {
    render(<MenuScreen />);

    await waitFor(() => expect(screen.getByText(t('menu.emptyDays.toConsult'))).toBeTruthy());
    fireEvent.press(screen.getByText(t('menu.emptyDays.toConsult')));
    expect(mockPush).toHaveBeenCalledWith('/recipes/consult');
  });

  it('押すと不足日数ぶんの一括生成が実際に走る（0 日でも下流へ届く）', async () => {
    render(<MenuScreen />);
    await waitFor(() =>
      expect(screen.getByText(tCount('menu.shortfall.bulkGenerate', 7))).toBeTruthy(),
    );

    fireEvent.press(screen.getByText(tCount('menu.shortfall.bulkGenerate', 7)));

    await waitFor(() => expect(mockGenerateMenuRecipes).toHaveBeenCalledTimes(1));
    expect(mockGenerateMenuRecipes.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ days: 7 }),
    );
    // 枠のゲートを飛ばしていない（無料枠を素通りさせない）
    expect(mockEnsureInferenceCredit).toHaveBeenCalled();
  });

  it('要求日数を持たない旧データではバナーを出さない（押せる先が無いため）', async () => {
    mockGetMenuPlan.mockResolvedValue({
      plan: {
        version: 1,
        mealTime: 'dinner',
        generatedAt: '2026-09-08T09:00:00.000Z',
        source: 'coverage',
        pantrySignature: '',
        days: [],
      },
      days: [],
      stale: false,
    } as unknown as MenuPlanView);

    render(<MenuScreen />);

    await waitFor(() => expect(screen.getByText(t('menu.emptyDays.title'))).toBeTruthy());
    expect(screen.queryByText(tCount('menu.shortfall.bulkGenerate', 7))).toBeNull();
    expect(screen.getByText(t('menu.emptyDays.noRecipes'))).toBeTruthy();
  });
});
