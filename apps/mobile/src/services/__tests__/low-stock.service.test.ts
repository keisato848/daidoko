jest.mock('../../db/client', () => ({ isNativePlatform: true }));
jest.mock('../pantry.service', () => ({ getPantryItems: jest.fn() }));
jest.mock('../app-meta.service', () => ({ getAppMeta: jest.fn(), setAppMeta: jest.fn() }));
jest.mock('../notification.service', () => ({ presentLowStockNotification: jest.fn() }));

import { getAppMeta, setAppMeta } from '../app-meta.service';
import { buildLowStockBody, checkAndNotifyLowStock, filterLowStock } from '../low-stock.service';
import { presentLowStockNotification } from '../notification.service';
import { getPantryItems } from '../pantry.service';
import type { PantryItem } from '../types';

function item(partial: Partial<PantryItem>): PantryItem {
  return {
    id: 'id',
    name: '卵',
    quantity: null,
    unit: null,
    lowStockThreshold: null,
    janCode: null,
    ...partial,
  };
}

const mockGetPantryItems = getPantryItems as jest.MockedFunction<typeof getPantryItems>;
const mockGetAppMeta = getAppMeta as jest.MockedFunction<typeof getAppMeta>;
const mockPresent = presentLowStockNotification as jest.MockedFunction<
  typeof presentLowStockNotification
>;

describe('filterLowStock', () => {
  it('keeps only items at/below their threshold', () => {
    const items = [
      item({ id: 'a', quantity: 1, lowStockThreshold: 1 }), // at threshold → low
      item({ id: 'b', quantity: 0, lowStockThreshold: 1 }), // below → low
      item({ id: 'c', quantity: 2, lowStockThreshold: 1 }), // above → not
      item({ id: 'd', quantity: null, lowStockThreshold: 1 }), // unmanaged qty → not
      item({ id: 'e', quantity: 0, lowStockThreshold: null }), // no threshold → not
      item({ id: 'f', quantity: 0, lowStockThreshold: 0 }), // 0 ≤ 0 → low
    ];
    expect(filterLowStock(items).map((it) => it.id)).toEqual(['a', 'b', 'f']);
  });
});

describe('buildLowStockBody', () => {
  it('joins names with 、', () => {
    expect(buildLowStockBody(['卵', '牛乳'])).toBe(
      '卵、牛乳 の残りが少なくなっています。買い物リストに追加しましょう。',
    );
  });

  it('truncates beyond 5 names with ほかN件', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(buildLowStockBody(names)).toBe(
      'a、b、c、d、e ほか2件 の残りが少なくなっています。買い物リストに追加しましょう。',
    );
  });
});

describe('checkAndNotifyLowStock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing when nothing is low', async () => {
    mockGetPantryItems.mockResolvedValue([item({ quantity: 5, lowStockThreshold: 1 })]);
    expect(await checkAndNotifyLowStock()).toBe(false);
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('notifies once and records the day', async () => {
    mockGetPantryItems.mockResolvedValue([item({ quantity: 1, lowStockThreshold: 1 })]);
    mockGetAppMeta.mockResolvedValue(null);
    mockPresent.mockResolvedValue('notif-1');

    expect(await checkAndNotifyLowStock()).toBe(true);
    expect(mockPresent).toHaveBeenCalledWith(expect.stringContaining('卵'));
    expect(setAppMeta).toHaveBeenCalledWith(
      'low_stock_notified_day',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('is silent when already notified today', async () => {
    mockGetPantryItems.mockResolvedValue([item({ quantity: 0, lowStockThreshold: 1 })]);
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`;
    mockGetAppMeta.mockResolvedValue(key);

    expect(await checkAndNotifyLowStock()).toBe(false);
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('does not consume the day when the notification is denied', async () => {
    mockGetPantryItems.mockResolvedValue([item({ quantity: 0, lowStockThreshold: 1 })]);
    mockGetAppMeta.mockResolvedValue(null);
    mockPresent.mockResolvedValue(null);

    expect(await checkAndNotifyLowStock()).toBe(false);
    expect(setAppMeta).not.toHaveBeenCalled();
  });
});
