/**
 * 献立ウィジェットの文言・行整形・サイズ出し分け（純関数）。JSX 描画部分
 * （`MenuWidget.tsx`）はネイティブモジュール経由のためここではテストしない
 * — `shoppingWidgetContent.test.ts` と同じ作法（`docs/ウィジェット設計.md` §2）。
 */
import { buildWidgetSnapshot } from '../../utils/widgetSnapshot';
import type { SnapshotInput, WidgetSnapshot } from '../../utils/widgetSnapshot';
import { MENU_URI, buildMenuWidgetContent, menuWidgetSize, recipeUri } from '../menuWidgetContent';
import type { MenuWidgetTodayContent, MenuWidgetWeekContent } from '../menuWidgetContent';

const NOW = new Date(2026, 7, 28, 9, 5); // 2026-08-28 09:05

function snapshot(over: Partial<SnapshotInput> = {}): WidgetSnapshot {
  return buildWidgetSnapshot({
    shoppingItems: [],
    menuDays: [],
    anchorDate: null,
    locale: 'ja',
    now: NOW,
    ...over,
  });
}

function asToday(content: ReturnType<typeof buildMenuWidgetContent>): MenuWidgetTodayContent {
  if (content.mode !== 'today') throw new Error('expected today content');
  return content;
}

function asWeek(content: ReturnType<typeof buildMenuWidgetContent>): MenuWidgetWeekContent {
  if (content.mode !== 'week') throw new Error('expected week content');
  return content;
}

describe('menuWidgetSize', () => {
  it('高さが十分（250dp+）なら large（週間）', () => {
    expect(menuWidgetSize(180, 250)).toBe('large');
    expect(menuWidgetSize(320, 320)).toBe('large');
  });

  it('低いときは幅で small / medium を分ける', () => {
    expect(menuWidgetSize(180, 110)).toBe('small');
    expect(menuWidgetSize(249, 110)).toBe('small');
    expect(menuWidgetSize(250, 110)).toBe('medium');
    expect(menuWidgetSize(320, 180)).toBe('medium');
  });
});

describe('buildMenuWidgetContent — スナップショット無し', () => {
  it('小/中は ja 固定で案内文（ロケールの手掛かりが無いため）', () => {
    const content = asToday(buildMenuWidgetContent(null, 'small'));
    expect(content.locale).toBe('ja');
    expect(content.dishName).toBeNull();
    expect(content.emptyMessage).toBe('アプリを開くと表示されます');
    expect(content.timeLabel).toBeNull();
    expect(content.uri).toBe(MENU_URI);
  });

  it('大でも案内文（週間・空の rows）', () => {
    const content = asWeek(buildMenuWidgetContent(null, 'large'));
    expect(content.rows).toEqual([]);
    expect(content.emptyMessage).toBe('アプリを開くと表示されます');
    expect(content.uri).toBe(MENU_URI);
  });
});

describe('buildMenuWidgetContent — 今日の一品（小/中）', () => {
  it('献立あり: 料理名を出し、タップ先はそのレシピ', () => {
    const snap = snapshot({
      menuDays: [{ title: '肉じゃが', doneAt: null, recipeId: 'r1', day: 1 }],
      anchorDate: '2026-08-28',
    });
    const content = asToday(buildMenuWidgetContent(snap, 'medium'));
    expect(content.heading).toBe('今日の一品'); // anchorDate あり → today
    expect(content.dishName).toBe('肉じゃが');
    expect(content.emptyMessage).toBeNull();
    expect(content.uri).toBe(recipeUri('r1'));
  });

  it('手動プラン（anchorDate 無し）は見出しが「次の一品」', () => {
    const snap = snapshot({
      menuDays: [{ title: '肉じゃが', doneAt: null, recipeId: 'r1' }],
    });
    expect(asToday(buildMenuWidgetContent(snap, 'small')).heading).toBe('次の一品');
  });

  it('献立なし: 案内文＋タップ先は献立画面', () => {
    const content = asToday(buildMenuWidgetContent(snapshot(), 'small'));
    expect(content.dishName).toBeNull();
    expect(content.emptyMessage).toBe('献立はまだありません');
    expect(content.uri).toBe(MENU_URI);
  });

  it('recipeId が無い献立（旧データ）はタップで献立画面へ', () => {
    // recipeId を渡さない = 旧アプリが書いた week 無しスナップショット相当
    const snap = snapshot({ menuDays: [{ title: '肉じゃが', doneAt: null }] });
    const content = asToday(buildMenuWidgetContent(snap, 'small'));
    expect(content.dishName).toBe('肉じゃが');
    expect(content.uri).toBe(MENU_URI);
  });

  it('「HH:mm 時点」を必ず出す（鮮度）', () => {
    const snap = snapshot({ menuDays: [{ title: 'x', doneAt: null, recipeId: 'r1' }] });
    expect(asToday(buildMenuWidgetContent(snap, 'small')).timeLabel).toBe('09:05 時点');
  });
});

describe('buildMenuWidgetContent — 週間一覧（大）', () => {
  const snap = snapshot({
    anchorDate: '2026-08-28',
    menuDays: [
      { title: '今日の分', doneAt: null, recipeId: 'r1', day: 1 },
      { title: '明日の分', doneAt: null, recipeId: 'r2', day: 2 },
      { title: '済んだ分', doneAt: '2026-08-27T10:00:00.000Z', recipeId: 'r3', day: 3 },
      { title: '消えた分', doneAt: null, missing: true, recipeId: 'r4', day: 4 },
    ],
  });

  it('今日の行を強調（isToday）し、タップ先はそのレシピ', () => {
    const content = asWeek(buildMenuWidgetContent(snap, 'large'));
    expect(content.rows[0]).toMatchObject({
      label: '今日の分',
      isToday: true,
      isDone: false,
      isUndecided: false,
      uri: recipeUri('r1'),
    });
    // 今日以外は強調しない
    expect(content.rows[1].isToday).toBe(false);
  });

  it('調理済みは isDone（薄く描く）', () => {
    const content = asWeek(buildMenuWidgetContent(snap, 'large'));
    expect(content.rows[2]).toMatchObject({ label: '済んだ分', isDone: true });
  });

  it('削除済み/未定は「—」＋グレー・タップは献立画面', () => {
    const content = asWeek(buildMenuWidgetContent(snap, 'large'));
    expect(content.rows[3]).toMatchObject({
      label: '—',
      isUndecided: true,
      uri: MENU_URI,
    });
  });

  it('実の献立が 1 つでもあれば emptyMessage は出さない', () => {
    expect(asWeek(buildMenuWidgetContent(snap, 'large')).emptyMessage).toBeNull();
  });

  it('全部未定（or 空）なら案内文を出す', () => {
    const empty = snapshot({
      anchorDate: '2026-08-28',
      menuDays: [{ title: '消えた', doneAt: null, missing: true, recipeId: 'r9', day: 1 }],
    });
    const content = asWeek(buildMenuWidgetContent(empty, 'large'));
    expect(content.rows).toHaveLength(1);
    expect(content.rows[0].isUndecided).toBe(true);
    expect(content.emptyMessage).toBe('献立はまだありません');
  });

  it('「HH:mm 時点」を必ず出す（鮮度）', () => {
    expect(asWeek(buildMenuWidgetContent(snap, 'large')).timeLabel).toBe('09:05 時点');
  });
});

describe('buildMenuWidgetContent — 不足行（要求日数に満たない・大）', () => {
  const oneDay = [{ title: '肉じゃが', doneAt: null, recipeId: 'r1', day: 1 }];

  it('組めた日数が要求に満たないとき末尾 1 行を出す', () => {
    const snap = snapshot({ menuDays: oneDay, requestedDays: 3 });
    const content = asWeek(buildMenuWidgetContent(snap, 'large'));
    expect(content.shortfallMessage).toBe('残り2日分はレシピが足りません');
  });

  it('要求どおり組めていれば出さない', () => {
    const snap = snapshot({ menuDays: oneDay, requestedDays: 1 });
    expect(asWeek(buildMenuWidgetContent(snap, 'large')).shortfallMessage).toBeNull();
  });

  it('requestedDays が無い（旧アプリ・旧プラン）なら出さない', () => {
    const snap = snapshot({ menuDays: oneDay });
    expect(asWeek(buildMenuWidgetContent(snap, 'large')).shortfallMessage).toBeNull();
  });

  it('実の献立が 1 つも無いときは出さない（noMenu の案内に一本化）', () => {
    const snap = snapshot({
      menuDays: [{ title: '消えた', doneAt: null, missing: true, recipeId: 'r9', day: 1 }],
      requestedDays: 3,
    });
    const content = asWeek(buildMenuWidgetContent(snap, 'large'));
    expect(content.shortfallMessage).toBeNull();
    expect(content.emptyMessage).toBe('献立はまだありません');
  });

  it('en は単複を分ける', () => {
    const one = snapshot({ locale: 'en', menuDays: oneDay, requestedDays: 2 });
    expect(asWeek(buildMenuWidgetContent(one, 'large')).shortfallMessage).toBe(
      'Not enough recipes for 1 more day',
    );
    const two = snapshot({ locale: 'en', menuDays: oneDay, requestedDays: 3 });
    expect(asWeek(buildMenuWidgetContent(two, 'large')).shortfallMessage).toBe(
      'Not enough recipes for 2 more days',
    );
  });

  it('小/中（今日の一品）には出さない（不足行は週間だけ）', () => {
    const snap = snapshot({ menuDays: oneDay, requestedDays: 3 });
    const content = asToday(buildMenuWidgetContent(snap, 'medium'));
    expect('shortfallMessage' in content).toBe(false);
  });
});

describe('buildMenuWidgetContent — en ロケール', () => {
  it('今日の一品を英語の文言で組む', () => {
    const snap = snapshot({
      locale: 'en',
      anchorDate: '2026-08-28',
      menuDays: [{ title: 'Nikujaga', doneAt: null, recipeId: 'r1', day: 1 }],
    });
    const content = asToday(buildMenuWidgetContent(snap, 'medium'));
    expect(content.heading).toBe("Today's dish");
    expect(content.timeLabel).toBe('as of 09:05');
  });

  it('週間の見出しも英語', () => {
    const snap = snapshot({
      locale: 'en',
      anchorDate: '2026-08-28',
      menuDays: [{ title: 'Nikujaga', doneAt: null, recipeId: 'r1', day: 1 }],
    });
    expect(asWeek(buildMenuWidgetContent(snap, 'large')).heading).toBe('This week');
  });
});
