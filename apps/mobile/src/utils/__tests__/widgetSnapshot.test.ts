/**
 * ウィジェットのスナップショット契約（W0・`docs/ウィジェット設計.md` §1）。
 *
 * ここで固定するのは**両 OS のウィジェットが依存する形**。壊すと
 * アプリ側は緑のままウィジェットだけが黙って空になる（実機でしか気づけない）。
 */
import {
  WIDGET_SHOPPING_PREVIEW,
  WIDGET_SNAPSHOT_VERSION,
  buildWidgetSnapshot,
  formatSnapshotTime,
  parseWidgetSnapshot,
  type SnapshotInput,
} from '../widgetSnapshot';

const NOW = new Date(2026, 7, 28, 9, 5); // 2026-08-28 09:05

function input(over: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    shoppingItems: [],
    menuDays: [],
    anchorDate: null,
    locale: 'ja',
    now: NOW,
    ...over,
  };
}

describe('buildWidgetSnapshot — 買い物', () => {
  it('未購入だけを数え、チェック済みは出さない', () => {
    const snapshot = buildWidgetSnapshot(
      input({
        shoppingItems: [
          { name: '卵', checked: false },
          { name: '牛乳', checked: true },
          { name: 'パン', checked: false },
        ],
      }),
    );
    expect(snapshot.shopping.remaining).toBe(2);
    expect(snapshot.shopping.names).toEqual(['卵', 'パン']);
  });

  it('品名は上限まで、総数は全部を数える（「ほか n 品」を出せるように）', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `品${i}`, checked: false }));
    const snapshot = buildWidgetSnapshot(input({ shoppingItems: many }));
    expect(snapshot.shopping.names).toHaveLength(WIDGET_SHOPPING_PREVIEW);
    expect(snapshot.shopping.remaining).toBe(12);
  });

  it('空でも組み立てる（書かないと前回の姿が残り続ける）', () => {
    const snapshot = buildWidgetSnapshot(input());
    expect(snapshot.shopping.remaining).toBe(0);
    expect(snapshot.shopping.names).toEqual([]);
    expect(snapshot.writtenAt).toBe(NOW.toISOString());
  });
});

describe('buildWidgetSnapshot — 献立の見出し規約', () => {
  const days = [{ title: '肉じゃが', doneAt: null }];

  it('anchorDate が無い（M1 手動）なら「次の一品」', () => {
    const snapshot = buildWidgetSnapshot(input({ menuDays: days, anchorDate: null }));
    expect(snapshot.menu.kind).toBe('next');
    expect(snapshot.menu.title).toBe('肉じゃが');
  });

  it('anchorDate があるとき（自動モード）だけ「今日」と言える', () => {
    const snapshot = buildWidgetSnapshot(input({ menuDays: days, anchorDate: '2026-08-28' }));
    expect(snapshot.menu.kind).toBe('today');
  });

  it('作り終わった日は飛ばして、次のまだの日を出す', () => {
    const snapshot = buildWidgetSnapshot(
      input({
        menuDays: [
          { title: '昨日の分', doneAt: '2026-08-27T18:00:00.000Z' },
          { title: '今日の分', doneAt: null },
        ],
      }),
    );
    expect(snapshot.menu.title).toBe('今日の分');
  });

  it('削除されたレシピの日は飛ばす（ウィジェットに「無くなりました」は出せない）', () => {
    const snapshot = buildWidgetSnapshot(
      input({
        menuDays: [
          { title: '消えたレシピ', doneAt: null, missing: true },
          { title: '生きている', doneAt: null },
        ],
      }),
    );
    expect(snapshot.menu.title).toBe('生きている');
  });

  it('全部済み・献立なしなら kind も title も null', () => {
    expect(buildWidgetSnapshot(input()).menu.kind).toBeNull();
    expect(
      buildWidgetSnapshot(input({ menuDays: [{ title: 'x', doneAt: '2026-08-27T00:00:00Z' }] }))
        .menu.title,
    ).toBeNull();
  });
});

describe('parseWidgetSnapshot — 読む側の防御', () => {
  const valid = buildWidgetSnapshot(
    input({
      shoppingItems: [{ name: '卵', checked: false }],
      menuDays: [{ title: 'a', doneAt: null }],
    }),
  );

  it('自分が書いたものは往復する', () => {
    expect(parseWidgetSnapshot(JSON.stringify(valid))).toEqual(valid);
  });

  it('知らない版は捨てる（壊れた形を描くより何も出さない方がよい）', () => {
    const future = { ...valid, version: WIDGET_SNAPSHOT_VERSION + 1 };
    expect(parseWidgetSnapshot(JSON.stringify(future))).toBeNull();
  });

  it('省略可フィールドが増えても読める（版を上げない前提）', () => {
    const extended = { ...valid, futureField: 'x' };
    expect(parseWidgetSnapshot(JSON.stringify(extended))?.menu.title).toBe('a');
  });

  it.each(['', 'not json', '{}', '[]', 'null'])('壊れた入力「%s」は null', (raw) => {
    expect(parseWidgetSnapshot(raw)).toBeNull();
  });

  it('必須が欠けていたら null', () => {
    expect(parseWidgetSnapshot(JSON.stringify({ ...valid, shopping: undefined }))).toBeNull();
    expect(parseWidgetSnapshot(JSON.stringify({ ...valid, locale: 'fr' }))).toBeNull();
    expect(parseWidgetSnapshot(JSON.stringify({ ...valid, menu: { kind: 'bogus' } }))).toBeNull();
  });

  it('品名に文字列でないものが混ざっても落ちない', () => {
    const dirty = { ...valid, shopping: { remaining: 2, names: ['卵', 42, null] } };
    expect(parseWidgetSnapshot(JSON.stringify(dirty))?.shopping.names).toEqual(['卵']);
  });
});

describe('formatSnapshotTime — 古さを黙って見せない', () => {
  it('HH:mm を返す', () => {
    expect(formatSnapshotTime(NOW.toISOString())).toBe('09:05');
  });

  it('壊れた値では空文字（表示を落とさない）', () => {
    expect(formatSnapshotTime('nope')).toBe('');
  });
});
