/**
 * menu-plan.service.ts の大半（loadMenuRecipes 等）は drizzle を動的 import しており、
 * jest はネイティブ DB 経路の動的 import を実行できない（`docs/品質基準.md` §2.3）。
 * ここでテストできるのは **DB を直接触らない** `refreshMenuNotificationSchedule`
 * （§10.11.4）だけ——依存はすべて他サービス経由（app-meta/notification）なのでモックで足りる。
 */
jest.mock('../../db/client', () => ({ isNativePlatform: true }));
jest.mock('../../db/sampleData', () => ({ shouldHideSeedRecipe: jest.fn(() => false) }));
jest.mock('../app-meta.service', () => ({
  getAppMeta: jest.fn(),
  setAppMeta: jest.fn(),
  getMenuAutoDays: jest.fn(),
  getMenuAutoNotifyTime: jest.fn(),
  isMenuAutoAddEnabled: jest.fn(),
  isMenuAutoEnabled: jest.fn(),
}));
jest.mock('../notification.service', () => ({
  cancelAllMenuNotifications: jest.fn(),
  scheduleMenuNotification: jest.fn(),
}));
jest.mock('../shopping-list.service', () => ({
  addShoppingItem: jest.fn(),
  getShoppingItems: jest.fn(),
  removeShoppingItem: jest.fn(),
}));
jest.mock('../sync-runner.service', () => ({ runSyncAndAwaitPull: jest.fn() }));
jest.mock('../widget-snapshot.service', () => ({ refreshWidgetSnapshot: jest.fn() }));

import {
  getAppMeta,
  getMenuAutoNotifyTime,
  isMenuAutoEnabled,
  setAppMeta,
} from '../app-meta.service';
import {
  readStoredMenuPlan,
  refreshMenuNotificationSchedule,
  undoMenuAutoAddedItems,
} from '../menu-plan.service';
import { cancelAllMenuNotifications, scheduleMenuNotification } from '../notification.service';
import { getShoppingItems, removeShoppingItem } from '../shopping-list.service';

const mockGetAppMeta = getAppMeta as jest.MockedFunction<typeof getAppMeta>;
const mockSetAppMeta = setAppMeta as jest.MockedFunction<typeof setAppMeta>;
const mockGetShoppingItems = getShoppingItems as jest.MockedFunction<typeof getShoppingItems>;
const mockRemoveShoppingItem = removeShoppingItem as jest.MockedFunction<typeof removeShoppingItem>;
const mockIsMenuAutoEnabled = isMenuAutoEnabled as jest.MockedFunction<typeof isMenuAutoEnabled>;
const mockGetMenuAutoNotifyTime = getMenuAutoNotifyTime as jest.MockedFunction<
  typeof getMenuAutoNotifyTime
>;
const mockCancelAll = cancelAllMenuNotifications as jest.MockedFunction<
  typeof cancelAllMenuNotifications
>;
const mockSchedule = scheduleMenuNotification as jest.MockedFunction<
  typeof scheduleMenuNotification
>;

describe('refreshMenuNotificationSchedule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMenuAutoNotifyTime.mockResolvedValue({ hour: 7, minute: 0 });
    mockCancelAll.mockResolvedValue(undefined);
    mockSchedule.mockResolvedValue('id-1');
  });

  it('掃引してから、自動モードがオフなら予約しない', async () => {
    mockIsMenuAutoEnabled.mockResolvedValue(false);
    await refreshMenuNotificationSchedule();
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('掃引してから、自動モードがオンなら 1 本だけ予約する', async () => {
    mockIsMenuAutoEnabled.mockResolvedValue(true);
    await refreshMenuNotificationSchedule();
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  // 再入対策の本体。通知権限ダイアログでの background/foreground 遷移により
  // 呼び出し元同士が互いを知らずに同時に呼ぶ状況を模す（§10.11.4 の顛末）。
  it('同時に呼んでも並走せず、1 回ずつ順番に「掃引→予約」する', async () => {
    mockIsMenuAutoEnabled.mockResolvedValue(true);
    const order: string[] = [];
    mockCancelAll.mockImplementation(async () => {
      order.push('cancel');
    });
    mockSchedule.mockImplementation(async () => {
      order.push('schedule');
      return 'id';
    });

    await Promise.all([refreshMenuNotificationSchedule(), refreshMenuNotificationSchedule()]);

    // 並走していれば cancel, cancel, schedule, schedule のような順序になりうる。
    // 直列なら必ず 1 回目の cancel→schedule が 2 回目の cancel より先に終わる。
    expect(order).toEqual(['cancel', 'schedule', 'cancel', 'schedule']);
    expect(mockCancelAll).toHaveBeenCalledTimes(2);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });

  it('前段が失敗しても待ち行列は止まらない（次の呼び出しは実行される）', async () => {
    mockIsMenuAutoEnabled.mockResolvedValue(true);
    mockCancelAll.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

    await expect(refreshMenuNotificationSchedule()).rejects.toThrow('boom');
    await refreshMenuNotificationSchedule();

    expect(mockCancelAll).toHaveBeenCalledTimes(2);
    expect(mockSchedule).toHaveBeenCalledTimes(1); // 1 回目は cancel で落ちて到達しない
  });
});

/**
 * `requestedDays`（§10.7 の結果フィードバック・W2 不足行用）の保存互換。
 * 生成側（generateMenuPlan）は DB の動的 import で jest では実行できないため、
 * DB を触らない読み口（readStoredMenuPlan）と書き直し経路（undoMenuAutoAddedItems の
 * スプレッド保存）で「旧データに無い・壊れた値・保持される」を固定する。
 */
describe('readStoredMenuPlan — requestedDays の互換', () => {
  const basePlan = {
    version: 1,
    generatedAt: '2026-09-05T00:00:00.000Z',
    source: 'coverage',
    pantrySignature: 'sig',
    days: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('保存されていれば読める', async () => {
    mockGetAppMeta.mockResolvedValue(JSON.stringify({ ...basePlan, requestedDays: 3 }));
    const plan = await readStoredMenuPlan();
    expect(plan?.requestedDays).toBe(3);
  });

  it('旧データ（requestedDays 無し）はプロパティ無しのまま読める（不足の表示は出ない）', async () => {
    mockGetAppMeta.mockResolvedValue(JSON.stringify(basePlan));
    const plan = await readStoredMenuPlan();
    expect(plan).not.toBeNull();
    expect(plan && 'requestedDays' in plan).toBe(false);
  });

  it.each(['3', 0, -1, 2.5, null])('壊れた値（%p）は落として読む', async (bad) => {
    mockGetAppMeta.mockResolvedValue(JSON.stringify({ ...basePlan, requestedDays: bad }));
    const plan = await readStoredMenuPlan();
    expect(plan).not.toBeNull();
    expect(plan?.requestedDays).toBeUndefined();
  });
});

describe('undoMenuAutoAddedItems — requestedDays を保持したまま書き直す', () => {
  it('取り消しの保存で requestedDays が落ちない', async () => {
    mockGetAppMeta.mockResolvedValue(
      JSON.stringify({
        version: 1,
        generatedAt: '2026-09-05T00:00:00.000Z',
        source: 'coverage',
        pantrySignature: 'sig',
        requestedDays: 5,
        autoAddedItemIds: ['a'],
        days: [],
      }),
    );
    mockGetShoppingItems.mockResolvedValue([{ id: 'a', checked: false }] as Awaited<
      ReturnType<typeof getShoppingItems>
    >);
    mockRemoveShoppingItem.mockResolvedValue(undefined as never);

    const removed = await undoMenuAutoAddedItems();

    expect(removed).toBe(1);
    const written = JSON.parse(mockSetAppMeta.mock.calls.at(-1)?.[1] as string) as {
      requestedDays?: number;
      autoAddedItemIds?: string[];
    };
    expect(written.requestedDays).toBe(5);
    expect(written.autoAddedItemIds).toEqual([]);
  });
});
