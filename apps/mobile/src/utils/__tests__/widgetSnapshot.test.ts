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

describe('buildWidgetSnapshot — 献立の recipeId と週間（W2）', () => {
  it('出す 1 品の recipeId を写す（タップ先）', () => {
    const snapshot = buildWidgetSnapshot(
      input({
        menuDays: [
          { title: '済み', doneAt: '2026-08-27T10:00:00.000Z', recipeId: 'r0' },
          { title: '肉じゃが', doneAt: null, recipeId: 'r1' },
        ],
      }),
    );
    expect(snapshot.menu.title).toBe('肉じゃが');
    expect(snapshot.menu.recipeId).toBe('r1');
  });

  it('recipeId が無い（旧データ）なら null', () => {
    const snapshot = buildWidgetSnapshot(input({ menuDays: [{ title: 'a', doneAt: null }] }));
    expect(snapshot.menu.recipeId).toBeNull();
  });

  it('週間は先頭 7 日分。anchorDate + day で「今日」を立てる', () => {
    const snapshot = buildWidgetSnapshot(
      input({
        anchorDate: '2026-08-28', // NOW と同じ暦日
        menuDays: [
          { title: '今日', doneAt: null, recipeId: 'r1', day: 1 },
          { title: '明日', doneAt: null, recipeId: 'r2', day: 2 },
        ],
      }),
    );
    expect(snapshot.menu.week).toHaveLength(2);
    expect(snapshot.menu.week?.[0]).toEqual({
      title: '今日',
      recipeId: 'r1',
      doneAt: null,
      isToday: true,
    });
    expect(snapshot.menu.week?.[1].isToday).toBe(false);
  });

  it('anchorDate が無い手動プランは「今日」を立てない', () => {
    const snapshot = buildWidgetSnapshot(
      input({ menuDays: [{ title: 'a', doneAt: null, recipeId: 'r1', day: 1 }] }),
    );
    expect(snapshot.menu.week?.[0].isToday).toBe(false);
  });

  it('削除済みの日は title/recipeId を null にして週間へ残す（—で描くため）', () => {
    const snapshot = buildWidgetSnapshot(
      input({
        menuDays: [{ title: '消えた', doneAt: null, missing: true, recipeId: 'r1', day: 1 }],
      }),
    );
    expect(snapshot.menu.week?.[0]).toEqual({
      title: null,
      recipeId: null,
      doneAt: null,
      isToday: false,
    });
  });

  it('週間は 8 日以上でも 7 日で打ち切る', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      title: `d${i}`,
      doneAt: null,
      recipeId: `r${i}`,
      day: i + 1,
    }));
    expect(buildWidgetSnapshot(input({ menuDays: many })).menu.week).toHaveLength(7);
  });

  it('requestedDays（不足行用）を写す', () => {
    const snapshot = buildWidgetSnapshot(
      input({ menuDays: [{ title: 'a', doneAt: null, day: 1 }], requestedDays: 3 }),
    );
    expect(snapshot.menu.requestedDays).toBe(3);
  });

  it('requestedDays が無い（旧プラン）・壊れた値なら載せない', () => {
    expect('requestedDays' in buildWidgetSnapshot(input()).menu).toBe(false);
    expect('requestedDays' in buildWidgetSnapshot(input({ requestedDays: null })).menu).toBe(false);
    expect('requestedDays' in buildWidgetSnapshot(input({ requestedDays: 0 })).menu).toBe(false);
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

  it('献立の recipeId と週間（W2）を往復する', () => {
    const withMenu = buildWidgetSnapshot(
      input({
        anchorDate: '2026-08-28',
        menuDays: [{ title: '肉じゃが', doneAt: null, recipeId: 'r1', day: 1 }],
      }),
    );
    const round = parseWidgetSnapshot(JSON.stringify(withMenu));
    expect(round?.menu.recipeId).toBe('r1');
    expect(round?.menu.week).toEqual(withMenu.menu.week);
  });

  it('requestedDays（不足行用）を往復する', () => {
    const withRequested = buildWidgetSnapshot(
      input({ menuDays: [{ title: 'a', doneAt: null, day: 1 }], requestedDays: 5 }),
    );
    expect(parseWidgetSnapshot(JSON.stringify(withRequested))?.menu.requestedDays).toBe(5);
  });

  it('requestedDays が無い（旧アプリが書いた）・壊れた値は「無い」として読む', () => {
    const round = parseWidgetSnapshot(JSON.stringify(valid));
    expect(round && 'requestedDays' in round.menu).toBe(false);
    const dirty = { ...valid, menu: { ...valid.menu, requestedDays: '5' } };
    const dirtyRound = parseWidgetSnapshot(JSON.stringify(dirty));
    expect(dirtyRound && 'requestedDays' in dirtyRound.menu).toBe(false);
  });

  it('週間が無い（旧アプリが書いた）スナップショットは空配列で読む', () => {
    const legacy = { ...valid, menu: { kind: 'next', title: '肉じゃが' } };
    const round = parseWidgetSnapshot(JSON.stringify(legacy));
    expect(round?.menu.recipeId).toBeNull();
    expect(round?.menu.week).toEqual([]);
  });

  it('週間に壊れた行が混ざっても落ちない（その行は正規化する）', () => {
    const dirty = {
      ...valid,
      menu: {
        kind: 'today',
        title: 'a',
        recipeId: 'r1',
        week: [{ title: 'a', recipeId: 'r1', doneAt: null, isToday: true }, 42, null],
      },
    };
    const round = parseWidgetSnapshot(JSON.stringify(dirty));
    expect(round?.menu.week).toEqual([{ title: 'a', recipeId: 'r1', doneAt: null, isToday: true }]);
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
