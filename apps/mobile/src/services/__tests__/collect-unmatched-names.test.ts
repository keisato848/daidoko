/**
 * 名寄せの解決対象は「**両側**の、ルールで当たらなかった名前」だけ（§6 の 2026-08 改訂）。
 *
 * 旧実装は在庫名しか辞書に入れなかったため、突合の片側しか canonical に寄らず、
 * 「AI が選んだ表記とレシピの表記が偶然揃ったときだけ効く」状態だった。
 * ここでは「レシピ材料側も対象になること」と「ルールで当たる名前は投げないこと」を固定する。
 */
import { collectUnmatchedNames } from '../cookable.service';
import type { RecipeListItem } from '../types';

function recipe(id: string, ingredientNames: string[]): RecipeListItem {
  return {
    id,
    title: id,
    titleReading: null,
    cookTimeMin: null,
    rating: null,
    tags: [],
    ingredientNames,
    createdAt: '2026-08-21T00:00:00.000Z',
    cookCount: 0,
    heroPhotoUri: null,
    pinnedAt: null,
  };
}

describe('collectUnmatchedNames', () => {
  it('ルールで当たる名前は対象にしない（払い損を避ける）', () => {
    // 完全一致
    expect(collectUnmatchedNames([recipe('r1', ['玉ねぎ'])], ['玉ねぎ'])).toEqual([]);
    // 部分一致（ぶなしめじ ⊇ しめじ）
    expect(collectUnmatchedNames([recipe('r2', ['しめじ'])], ['ぶなしめじ'])).toEqual([]);
  });

  it('**レシピ材料側**の当たらない名前を拾う（旧実装が取りこぼしていた側）', () => {
    const unmatched = collectUnmatchedNames([recipe('r1', ['人参'])], ['にんじん']);
    expect(unmatched).toContain('人参');
  });

  it('在庫側の当たらない名前も拾う', () => {
    const unmatched = collectUnmatchedNames([recipe('r1', ['卵'])], ['とっとごたまご']);
    expect(unmatched).toContain('とっとごたまご');
  });

  it('辞書で既に繋がっている組は対象にしない（同じ名前を二度解決しない）', () => {
    const aliases = { 人参: 'にんじん', にんじん: 'にんじん' };
    expect(collectUnmatchedNames([recipe('r1', ['人参'])], ['にんじん'], aliases)).toEqual([]);
  });

  it('重複は畳む（同じ材料が複数レシピに出ても1回だけ解決する）', () => {
    const unmatched = collectUnmatchedNames(
      [recipe('r1', ['人参']), recipe('r2', ['人参'])],
      ['にんじん'],
    );
    expect(unmatched.filter((name) => name === '人参')).toHaveLength(1);
  });

  it('在庫が空でも材料名を拾える（初回に辞書を育てられる）', () => {
    expect(collectUnmatchedNames([recipe('r1', ['人参'])], [])).toEqual(['人参']);
  });

  it('表記ゆれは正規化で吸収し、解決対象にしない（NFKC・カナ折り畳み）', () => {
    // 全角/半角・カタカナ/ひらがなは normalizeItemName が吸収するのでルールで当たる
    expect(collectUnmatchedNames([recipe('r1', ['ﾆﾝｼﾞﾝ'])], ['にんじん'])).toEqual([]);
  });
});
