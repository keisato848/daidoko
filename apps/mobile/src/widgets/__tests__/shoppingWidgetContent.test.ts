/**
 * 買い物リストウィジェットの文言・行整形（純関数）。JSX 描画部分
 * （`ShoppingListWidget.tsx`）はネイティブモジュール経由のためここではテストしない
 * — R5 実装方針（`docs/ウィジェット設計.md` タスク指示）。
 */
import { buildWidgetSnapshot } from '../../utils/widgetSnapshot';
import type { WidgetSnapshot } from '../../utils/widgetSnapshot';
import {
  WIDGET_PREVIEW_COUNT,
  buildShoppingWidgetContent,
  widgetSizeFromWidth,
} from '../shoppingWidgetContent';

function snapshotWith(names: string[], over: Partial<WidgetSnapshot> = {}): WidgetSnapshot {
  return {
    ...buildWidgetSnapshot({
      shoppingItems: names.map((name) => ({ name, checked: false })),
      menuDays: [],
      anchorDate: null,
      locale: 'ja',
      now: new Date(2026, 7, 28, 9, 5),
    }),
    ...over,
  };
}

describe('widgetSizeFromWidth', () => {
  it('250dp 未満は small', () => {
    expect(widgetSizeFromWidth(180)).toBe('small');
    expect(widgetSizeFromWidth(249)).toBe('small');
  });

  it('250dp 以上は medium', () => {
    expect(widgetSizeFromWidth(250)).toBe('medium');
    expect(widgetSizeFromWidth(320)).toBe('medium');
  });
});

describe('buildShoppingWidgetContent — スナップショット無し', () => {
  it('ja 固定で案内文を出す（ロケールの手掛かりが無いため）', () => {
    const content = buildShoppingWidgetContent(null, 'small');
    expect(content.locale).toBe('ja');
    expect(content.emptyMessage).toBe('アプリを開くと表示されます');
    expect(content.countLabel).toBeNull();
    expect(content.timeLabel).toBeNull();
    expect(content.lines).toEqual([]);
  });
});

describe('buildShoppingWidgetContent — 小サイズ', () => {
  it('上位 3 品名まで・「ほか」は出さない', () => {
    const snapshot = snapshotWith(['卵', '牛乳', 'パン', '米', '味噌']);
    const content = buildShoppingWidgetContent(snapshot, 'small');
    expect(content.lines).toEqual(['卵', '牛乳', 'パン']);
    expect(content.moreLabel).toBeNull();
    expect(content.countLabel).toBe('未購入 5 品');
  });
});

describe('buildShoppingWidgetContent — 中サイズ', () => {
  it('最大 6 行＋「ほか n 品」', () => {
    const names = Array.from({ length: 9 }, (_, i) => `品${i}`);
    const snapshot = snapshotWith(names);
    const content = buildShoppingWidgetContent(snapshot, 'medium');
    expect(content.lines).toHaveLength(WIDGET_PREVIEW_COUNT.medium);
    expect(content.moreLabel).toBe('ほか 3 品');
  });

  it('6 件以内なら「ほか」は出さない', () => {
    const snapshot = snapshotWith(['卵', '牛乳']);
    const content = buildShoppingWidgetContent(snapshot, 'medium');
    expect(content.lines).toEqual(['卵', '牛乳']);
    expect(content.moreLabel).toBeNull();
  });
});

describe('buildShoppingWidgetContent — 空（全部購入済み）', () => {
  it('案内文を出し、件数・行は空', () => {
    const snapshot = snapshotWith([]);
    const content = buildShoppingWidgetContent(snapshot, 'small');
    expect(content.emptyMessage).toBe('買うものはありません');
    expect(content.countLabel).toBeNull();
    expect(content.lines).toEqual([]);
    // 空でも「HH:mm 時点」は出す（設計 §2: 必ず表示）
    expect(content.timeLabel).toBe('09:05 時点');
  });
});

describe('buildShoppingWidgetContent — 「HH:mm 時点」は必ず出る', () => {
  it('中身があっても時刻ラベルを出す', () => {
    const snapshot = snapshotWith(['卵']);
    expect(buildShoppingWidgetContent(snapshot, 'small').timeLabel).toBe('09:05 時点');
  });
});

describe('buildShoppingWidgetContent — en ロケール', () => {
  it('英語の文言で組む', () => {
    const snapshot = snapshotWith(['egg', 'milk'], { locale: 'en' });
    const content = buildShoppingWidgetContent(snapshot, 'medium');
    expect(content.title).toBe('Shopping List');
    expect(content.countLabel).toBe('2 to buy');
    expect(content.timeLabel).toBe('as of 09:05');
  });
});
