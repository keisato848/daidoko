/**
 * 料理の出自推定 `inferCuisine` と盛り付け行 `platingLineFor` の契約
 * （`docs/レシピ表紙AI生成設計.md` §2-1「プロンプト（C-1・2026-09-13）」・Issue #313）。
 *
 * ここが**契約の正**。server 側 `apps/server/src/lib/cuisine.ts` は写しで、語彙表と
 * 盛り付け行のズレは server の `shared-parity.test.ts` が見張る。ここでは判定順序
 * （タグ → 料理名 → 材料名・先に単独最多で決まった段で打ち切る）と照合規則
 * （タグ・材料は完全一致、料理名は部分一致、表記ゆれは `vocabKey` で吸収）を固定する。
 */
import { describe, expect, it } from 'vitest';

import { CUISINES, inferCuisine, platingLineFor } from '../constants/cuisine';

describe('inferCuisine — タグが最優先', () => {
  it('タグ「和食」があれば料理名が「パスタ」でも japanese（タイトル段は見ない）', () => {
    expect(inferCuisine('パスタ', ['和食'])).toBe('japanese');
  });

  it('タグで決まれば材料段も見ない（材料がイタリアン寄りでも中華）', () => {
    expect(inferCuisine('炒め物', ['中華'], ['オリーブオイル', 'バジル'])).toBe('chinese');
  });

  it('タグは完全一致 — 「和食好き」のような複合語は当たらず、タイトル段へ落ちる', () => {
    expect(inferCuisine('パスタ', ['和食好き'])).toBe('italian');
  });

  it('タグが同点（和食 と 洋食）ならタグ段では決めず、タイトル段へ落ちる', () => {
    expect(inferCuisine('パスタ', ['和食', '洋食'])).toBe('italian');
  });

  it('タグは件数の多い出自が勝つ（洋食 2 件 vs 和食 1 件 → western）', () => {
    expect(inferCuisine('パスタ', ['和食', '洋食', '洋風'])).toBe('western');
  });
});

describe('inferCuisine — 料理名は部分一致・材料名は完全一致', () => {
  it('料理名は部分一致（「ボロネーゼパスタ」→ italian）', () => {
    expect(inferCuisine('ボロネーゼパスタ')).toBe('italian');
  });

  it('料理名で決まれば材料段は見ない（ハンバーグ + イタリアン材料 2 件でも western）', () => {
    // 段をまたいで合算すると italian 2 > western 1 になってしまう。打ち切りの検証
    expect(inferCuisine('ハンバーグ', [], ['オリーブオイル', 'バジル'])).toBe('western');
  });

  it('料理名が同点（麻婆パスタ: chinese 1 vs italian 1）なら材料段へ落ちる', () => {
    expect(inferCuisine('麻婆パスタ', [], ['豆板醤'])).toBe('chinese');
  });

  it('材料名は完全一致（「味噌」は当たる）', () => {
    expect(inferCuisine('鍋', [], ['味噌'])).toBe('japanese');
  });

  it('材料名は複合語を拾わない（「味噌だれ」は当たらず null）', () => {
    expect(inferCuisine('鍋', [], ['味噌だれ'])).toBeNull();
  });

  it('材料名は件数の多い出自が勝つ（和食 2 件 vs 中華 1 件）', () => {
    expect(inferCuisine('鍋', [], ['味噌', 'だし', '豆板醤'])).toBe('japanese');
  });
});

describe('inferCuisine — 表記ゆれを吸収する', () => {
  it('半角カナ・全角カナ・ひらがな・全角空白入りが同じ結果になる', () => {
    const results = ['ﾊﾟｽﾀ', 'パスタ', 'ぱすた', 'ボロネーゼ　パスタ', 'ボロネーゼ パスタ'].map(
      (title) => inferCuisine(title),
    );
    expect(results).toEqual(['italian', 'italian', 'italian', 'italian', 'italian']);
  });

  it('英語は大文字小文字を区別しない（タグ Japanese / 料理名 CARBONARA）', () => {
    expect(inferCuisine('CARBONARA')).toBe('italian');
    expect(inferCuisine('パスタ', ['Japanese'])).toBe('japanese');
  });

  it('材料名の完全一致も表記ゆれを吸収する（「 みそ 」「ﾐｿ」）', () => {
    expect(inferCuisine('鍋', [], [' みそ '])).toBe('japanese');
    expect(inferCuisine('鍋', [], ['ﾐｿ'])).toBe('japanese');
  });
});

describe('inferCuisine — 判定不能', () => {
  it('タグ無し・料理名も材料も語彙に無ければ null', () => {
    expect(inferCuisine('野菜炒め', [], ['鶏肉', '玉ねぎ', '塩'])).toBeNull();
  });

  it('引数省略（タグ・材料なし）でも落ちずに null', () => {
    expect(inferCuisine('野菜炒め')).toBeNull();
  });

  it('全段が同点なら null（タグ同点 → 料理名同点 → 材料同点）', () => {
    expect(inferCuisine('麻婆パスタ', ['和食', '洋食'], ['豆板醤', 'バジル'])).toBeNull();
  });
});

describe('platingLineFor — 出自 × locale の盛り付け行', () => {
  it('全 CUISINES × ja/en で空でない文字列を返す', () => {
    for (const cuisine of CUISINES) {
      for (const locale of ['ja', 'en'] as const) {
        expect(platingLineFor(cuisine, locale).length).toBeGreaterThan(0);
      }
    }
  });

  it('10 通りがすべて別々の文字列（コピペで同じ行が残っていない）', () => {
    const lines = CUISINES.flatMap((cuisine) =>
      (['ja', 'en'] as const).map((locale) => platingLineFor(cuisine, locale)),
    );
    expect(new Set(lines).size).toBe(CUISINES.length * 2);
  });

  it('ja の行は日本語・en の行は英語で書かれている（locale の取り違えを検出）', () => {
    for (const cuisine of CUISINES) {
      expect(platingLineFor(cuisine, 'ja')).toMatch(/[ぁ-んァ-ン一-龥]/);
      expect(platingLineFor(cuisine, 'en')).not.toMatch(/[ぁ-んァ-ン一-龥]/);
    }
  });
});
