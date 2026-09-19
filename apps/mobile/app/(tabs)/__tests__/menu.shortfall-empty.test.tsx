/**
 * S20 献立 — 蔵書 0 件でも一括生成に到達できる（設計 §10.12.2・2026-09-08 の不具合）。
 *
 * 「1 日も組めなかった」ときだけ空状態へ落ち、押せるのが 1 品ずつの相談だけになっていた。
 * M3（§10.12）の動機はコールドスタートを解くことなので、**不足日数が最大のこの場面こそ**
 * 「足りない◯日分をまとめて作る」が要る。塞いでいたのは `shortfall` を `hasPlan` で
 * 絞っていた描画の分岐 1 か所で、下流（generateMenuPlan / runBulkGenerate）は 0 日でも動く。
 *
 * このテストは「0 日のプランでバナーが出る」ことと「そこから一括生成が実際に走る」ことを
 * 見る。`hasPlan` 条件を戻すと 5 本中 3 本（バナー表示・一括生成ボタン表示・押下）が赤くなる。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import MenuScreen from '../menu';
import { t, tCount } from '../../../src/i18n';
import type { MenuPlanView } from '../../../src/services/menu-plan.service';

const mockGetMenuPlan = jest.fn();
const mockGenerateMenuRecipes = jest.fn();
const mockEnsureInferenceCredit = jest.fn();
const mockPush = jest.fn();
const mockSubmitMenuBulkJob = jest.fn();
const mockCheckPendingMenuBulkJob = jest.fn();

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
  // v20・PR-3: 枠の定義。空 = 主菜 1 枠だけ（`orderedSlots` が既定へ倒す）
  getMenuSlotSettings: jest.fn(async () => []),
  generateMenuPlan: jest.fn(async () => null),
  buildMenuBulkContext: jest.fn(async () => ({ existingTitles: [], pantryNames: [] })),
  buildMenuArrangeContext: jest.fn(async () => null),
  buildMenuShoppingPlan: jest.fn(async () => []),
  addMenuShoppingRows: jest.fn(async () => 0),
  applyMenuArrangement: jest.fn(async () => null),
  fillMenuPlanShortfall: jest.fn(async () => null),
  addMenuPlanSlotEntries: jest.fn(async () => null),
  replaceMenuDay: jest.fn(async () => ({ outcome: 'no-candidates' })),
  undoMenuAutoAddedItems: jest.fn(async () => undefined),
}));

jest.mock('../../../src/services/menu-recipes.provider', () => ({
  // menu.tsx は同じモジュールから受け取るので instanceof は一致する
  MenuRecipesError: class MenuRecipesError extends Error {},
  generateMenuRecipes: (...args: unknown[]) => mockGenerateMenuRecipes(...(args as [])),
  usesManagedMenuRecipes: jest.fn(async () => true),
}));

// 非同期ジョブ（R34）。既定は「控えなし」「サーバーがジョブ経路を持たない」= 従来の同期経路へ倒れる
jest.mock('../../../src/services/menu-bulk-job.service', () => ({
  submitMenuBulkJob: (...args: unknown[]) => mockSubmitMenuBulkJob(...(args as [])),
  checkPendingMenuBulkJob: (...args: unknown[]) => mockCheckPendingMenuBulkJob(...(args as [])),
  discardMenuBulkResult: jest.fn(async () => undefined),
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
    recipeMeta: new Map(),
  }) as unknown as MenuPlanView;

describe('S20 献立 — レシピ 0 件からの一括生成（§10.12.2）', () => {
  beforeEach(() => {
    mockGetMenuPlan.mockReset().mockResolvedValue(emptyPlanView(7));
    mockGenerateMenuRecipes.mockReset().mockResolvedValue([]);
    mockEnsureInferenceCredit.mockReset().mockResolvedValue('ready');
    mockPush.mockReset();
    mockSubmitMenuBulkJob.mockReset().mockResolvedValue({ outcome: 'unsupported' });
    mockCheckPendingMenuBulkJob.mockReset().mockResolvedValue({ state: 'none' });
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

  it('**サーバーがジョブ経路を持たない（未デプロイ）ときは、従来の同期経路で最後まで動く**', async () => {
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
      recipeMeta: new Map(),
    } as unknown as MenuPlanView);

    render(<MenuScreen />);

    await waitFor(() => expect(screen.getByText(t('menu.emptyDays.title'))).toBeTruthy());
    expect(screen.queryByText(tCount('menu.shortfall.bulkGenerate', 7))).toBeNull();
    expect(screen.getByText(t('menu.emptyDays.noRecipes'))).toBeTruthy();
  });
});

/**
 * 献立がある状態の週ビュー（PR-3）。**空プランのテストだけでは、画面が料理名を
 * 1 つも描かなくなっても全部緑のまま**になるので、描画側をここで押さえる。
 *
 * **守れる範囲は画面だけ。** `getMenuPlan` はモックなので、サービス層の `hydrate` が
 * `plan.slots` を `days` に揃えるのをやめても、ここは緑のままになる（差し替え後に
 * 前の料理名が残る類）。その規則は `applyDaysToSlots` の純関数テストが持っていて、
 * 「`hydrate` がそれを呼ぶ」ところだけはテストの外（§2.3 の動的 import の制約）。
 */
describe('S20 献立 — 週ビュー（PR-3）', () => {
  const planWithDays = () =>
    ({
      plan: {
        version: 1,
        mealTime: 'dinner',
        generatedAt: '2026-09-18T09:00:00.000Z',
        source: 'coverage',
        pantrySignature: '',
        requestedDays: 2,
        days: [
          { day: 1, recipeId: 'r1', title: '肉じゃが', reason: '', doneAt: null },
          { day: 2, recipeId: 'r2', title: '麻婆豆腐', reason: '', doneAt: 'done' },
        ],
        slots: [
          { day: 1, slotId: 'main', recipeId: 'r1', title: '肉じゃが', reason: '', doneAt: null },
          { day: 2, slotId: 'main', recipeId: 'r2', title: '麻婆豆腐', reason: '', doneAt: 'done' },
        ],
      },
      days: [
        {
          day: 1,
          recipeId: 'r1',
          title: '肉じゃが',
          reason: '',
          doneAt: null,
          missing: false,
          heroPhotoUri: null,
          cookTimeMin: 30,
        },
        {
          day: 2,
          recipeId: 'r2',
          title: '麻婆豆腐',
          reason: '',
          doneAt: 'done',
          missing: false,
          heroPhotoUri: null,
          cookTimeMin: null,
        },
      ],
      stale: false,
      // PR-5a: 枠の「◯分」「無くなった」は days ではなく recipeMeta から引く（副菜以降も同じ経路）
      recipeMeta: new Map([
        ['r1', { missing: false, cookTimeMin: 30 }],
        ['r2', { missing: false, cookTimeMin: null }],
      ]),
    }) as unknown as MenuPlanView;

  beforeEach(() => {
    mockGetMenuPlan.mockReset().mockResolvedValue(planWithDays());
    mockPush.mockReset();
    mockSubmitMenuBulkJob.mockReset().mockResolvedValue({ outcome: 'unsupported' });
    mockCheckPendingMenuBulkJob.mockReset().mockResolvedValue({ state: 'none' });
  });

  it('枠に入っている料理名を出す', async () => {
    render(<MenuScreen />);

    await waitFor(() => expect(screen.getByText('肉じゃが')).toBeTruthy());
    expect(screen.getByText('麻婆豆腐')).toBeTruthy();
    expect(screen.getByText(t('menu.day.minutes', { count: 30 }))).toBeTruthy();
  });

  it('週の進み具合を出す（分母は献立がある日）', async () => {
    render(<MenuScreen />);

    await waitFor(() =>
      expect(screen.getByText(t('menu.week.progress', { done: '1', total: '2' }))).toBeTruthy(),
    );
  });

  it('料理名を押すとそのレシピへ遷移する', async () => {
    render(<MenuScreen />);

    await waitFor(() => expect(screen.getByText('肉じゃが')).toBeTruthy());
    fireEvent.press(screen.getByText('肉じゃが'));
    expect(mockPush).toHaveBeenCalledWith('/recipes/r1');
  });
});

/**
 * 一括生成の非同期ジョブ（R34）。**受理されたら画面を塞がない**ことと、
 * 画面を離れて戻っても（＝再マウントしても）状態が消えないことを押さえる。
 * 控えは app_meta にあり、画面は `checkPendingMenuBulkJob` の返事だけを映す。
 */
describe('S20 献立 — 一括生成の非同期ジョブ（R34）', () => {
  const PENDING = {
    jobId: 'job-1',
    mealTime: 'dinner',
    submittedAt: '2026-09-19T09:00:00.000Z',
    hasPushToken: true,
  };
  const draft = (title: string) => ({
    title,
    ingredients: [{ name: '鶏むね肉' }],
    steps: [{ body: '焼く' }],
  });

  beforeEach(() => {
    mockGetMenuPlan.mockReset().mockResolvedValue(emptyPlanView(7));
    mockGenerateMenuRecipes.mockReset().mockResolvedValue([]);
    mockEnsureInferenceCredit.mockReset().mockResolvedValue('ready');
    mockSubmitMenuBulkJob.mockReset().mockResolvedValue({ outcome: 'queued', job: PENDING });
    mockCheckPendingMenuBulkJob.mockReset().mockResolvedValue({ state: 'none' });
  });

  it('受理されたら「できたらお知らせします」を出し、同期の生成は呼ばない（待たない）', async () => {
    render(<MenuScreen />);
    await waitFor(() =>
      expect(screen.getByText(tCount('menu.shortfall.bulkGenerate', 7))).toBeTruthy(),
    );
    fireEvent.press(screen.getByText(tCount('menu.shortfall.bulkGenerate', 7)));

    await waitFor(() => expect(screen.getByText(t('menu.bulk.queued'))).toBeTruthy());
    expect(mockGenerateMenuRecipes).not.toHaveBeenCalled();
    // 主菜の不足 7 日ぶんを 1 part で頼んでいる（主菜 1 枠の設定では副菜の part は無い）
    const parts = mockSubmitMenuBulkJob.mock.calls[0]?.[0] as {
      key: string;
      request: { days: number };
    }[];
    expect(parts.map((p) => [p.key, p.request.days])).toEqual([['main', 7]]);
    // 無料枠のゲートは投入の前に通す
    expect(mockEnsureInferenceCredit).toHaveBeenCalled();
  });

  it('**再マウントしても「生成中」が出て、二重に投入できない**（控えは画面の state ではない）', async () => {
    mockCheckPendingMenuBulkJob.mockResolvedValue({ state: 'pending', job: PENDING });
    render(<MenuScreen />);

    await waitFor(() => expect(screen.getByText(t('menu.bulk.queued'))).toBeTruthy());
    fireEvent.press(screen.getByText(tCount('menu.shortfall.bulkGenerate', 7)));
    expect(mockSubmitMenuBulkJob).not.toHaveBeenCalled();
  });

  it('通知を頼めなかったときは「戻ってきて確認してください」側の文言', async () => {
    mockCheckPendingMenuBulkJob.mockResolvedValue({
      state: 'pending',
      job: { ...PENDING, hasPushToken: false },
    });
    render(<MenuScreen />);
    await waitFor(() => expect(screen.getByText(t('menu.bulk.queuedNoPush'))).toBeTruthy());
    expect(screen.queryByText(t('menu.bulk.queued'))).toBeNull();
  });

  it('結果が届いていたら提案シートが開き、作れなかった種類を 1 行で言う', async () => {
    mockCheckPendingMenuBulkJob.mockResolvedValue({
      state: 'ready',
      result: {
        mealTime: 'dinner',
        parts: [{ key: 'main', drafts: [draft('鶏の照り焼き')] }],
        failedKinds: ['soup'],
      },
    });
    render(<MenuScreen />);

    await waitFor(() => expect(screen.getByText('鶏の照り焼き')).toBeTruthy());
    expect(screen.getByText(t('menu.bulk.sheetTitle'))).toBeTruthy();
    expect(
      screen.getByText(t('menu.bulk.partFailed', { kinds: t('menu.slotKind.soup') })),
    ).toBeTruthy();
    expect(screen.queryByText(t('menu.bulk.queued'))).toBeNull();
  });

  it.each([
    ['failed', 'menu.bulk.jobFailed'],
    ['expired', 'menu.bulk.jobExpired'],
  ] as const)('%s は理由を言って、ボタンをもう一度押せる状態に戻す', async (state, key) => {
    mockCheckPendingMenuBulkJob.mockResolvedValue(
      state === 'failed' ? { state, retryable: true } : { state },
    );
    render(<MenuScreen />);
    await waitFor(() => expect(screen.getByText(t(key))).toBeTruthy());
    expect(screen.queryByText(t('menu.bulk.queued'))).toBeNull();
  });
});
