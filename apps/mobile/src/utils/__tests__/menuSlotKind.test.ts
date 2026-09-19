import { classifySlotKind } from '../menuSlotKind';

/**
 * 語彙分類（PR-5a）。**外れることの方が多い前提**なので、ここで固定するのは
 * 「当てるべきものを当てる」と「主菜を副菜にしない」の両側。語彙を増やしたら 1 行足す。
 */
describe('classifySlotKind — タグ優先・題名は部分一致・当たらなければ null', () => {
  it.each([
    ['味噌汁', 'soup'],
    ['豚汁', 'soup'],
    ['かぼちゃのポタージュ', 'soup'],
    ['ほうれん草のおひたし', 'side'],
    ['小松菜のごま和え', 'side'],
    ['きんぴらごぼう', 'side'],
    ['冷奴', 'side'],
    ['シーザーサラダ', 'salad'],
    ['プリン', 'dessert'],
    ['Miso Soup', 'soup'],
    ['Caesar Salad', 'salad'],
  ])('題名「%s」→ %s', (title, kind) => {
    expect(classifySlotKind(title)).toBe(kind);
  });

  it.each(['唐揚げ', '肉じゃが', 'ハンバーグ', '炊き込みご飯', 'カレーライス', 'Chicken Katsu'])(
    '主菜「%s」は null（副菜にしない）',
    (title) => {
      expect(classifySlotKind(title)).toBeNull();
    },
  );

  it('タグは完全一致で、題名より優先する', () => {
    // 題名は主菜っぽいが、利用者が「副菜」タグを付けた → 副菜
    expect(classifySlotKind('鶏そぼろ', ['副菜'])).toBe('side');
    expect(classifySlotKind('Chicken', ['Side Dish'])).toBe('side');
  });

  it('タグの部分一致では当てない（「副菜っぽい」のような自由タグを拾わない）', () => {
    expect(classifySlotKind('鶏そぼろ', ['副菜っぽい'])).toBeNull();
  });

  it('全角・半角・大文字小文字の揺れを吸収する', () => {
    expect(classifySlotKind('ＭＩＳＯ　ＳＯＵＰ')).toBe('soup');
    expect(classifySlotKind('肉じゃが', ['ＳＯＵＰ'])).toBe('soup');
  });

  it('タグが無くても落ちない（省略可）', () => {
    expect(classifySlotKind('味噌汁', undefined)).toBe('soup');
  });
});
