/**
 * 数と日付の扱い。**日本語で書いていると気づけない**ところなので、
 * 英語ロケールでの出方を固定しておく。
 */
import type { z } from 'zod';

import { setLocale, t, tCount, tDynamic } from '../index';
import { formatMonthDay, formatMonthLabel, formatYearMonth } from '../format';
import { recipeFormSchema } from '../../validation/recipe.schema';

afterEach(() => setLocale('ja'));

describe('tCount — 数の入る文言', () => {
  it('ja は単複を区別せず、1 でも複数でも同じ形で出る', () => {
    setLocale('ja');
    expect(tCount('home.select.count', 1)).toBe('1件選択中');
    expect(tCount('home.select.count', 3)).toBe('3件選択中');
  });

  it('en は 1 と複数で形が変わる', () => {
    setLocale('en');
    expect(tCount('home.bonus.title', 1)).toBe('1 free AI recipe is on us');
    expect(tCount('home.bonus.title', 3)).toBe('3 free AI recipes are on us');
  });

  it('0 は複数形を使う（英語の規則）', () => {
    setLocale('en');
    expect(tCount('home.bonus.title', 0)).toBe('0 free AI recipes are on us');
  });

  it('A 階層の複数形は text を返す（{text,intent} が漏れない）', () => {
    setLocale('ja');
    expect(tCount('home.delete.confirm', 2)).toBe(
      '2件の調理ログを削除しますか？この操作は取り消せません。',
    );
    setLocale('en');
    expect(tCount('home.delete.confirm', 1)).toBe(
      'Delete 1 cooking record? This cannot be undone.',
    );
    expect(tCount('home.delete.confirm', 5)).toBe(
      'Delete 5 cooking records? This cannot be undone.',
    );
  });

  it('どのロケールでも [object Object] や [missing…] を出さない', () => {
    for (const locale of ['ja', 'en'] as const) {
      setLocale(locale);
      for (const count of [0, 1, 2]) {
        for (const key of [
          'home.select.count',
          'home.bonus.title',
          'home.delete.confirm',
        ] as const) {
          const result = tCount(key, count);
          expect(result).not.toContain('[object Object]');
          expect(result).not.toContain('missing');
          expect(result).toContain(String(count));
        }
      }
    }
  });
});

describe('日付の書式', () => {
  // 2026-08-04。月は 0 起算
  const date = new Date(2026, 7, 4);

  it('ja は 月日 の形', () => {
    setLocale('ja');
    expect(formatMonthDay(date)).toBe('08月04日');
    expect(formatMonthLabel(date)).toBe('8月');
    expect(formatYearMonth(date)).toBe('2026年8月');
  });

  it('en は月名を使う（08月04日 のままにしない）', () => {
    setLocale('en');
    expect(formatMonthDay(date)).toBe('Aug 4');
    expect(formatMonthLabel(date)).toBe('August');
    expect(formatYearMonth(date)).toBe('August 2026');
  });

  it('12 か月すべてに月名がある', () => {
    setLocale('en');
    for (let month = 0; month < 12; month += 1) {
      const label = formatMonthLabel(new Date(2026, month, 1));
      expect(label).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});

describe('入力の検証メッセージ（Zod）', () => {
  /**
   * スキーマは辞書のキーを持つ。**キーを打ち間違えると画面に
   * `recipe.validation.titleRequired` がそのまま出る**ので、
   * 実際に解決できることを確かめる。
   */
  // 必須項目はすべて渡す。抜けがあると Zod 既定の "Required" が混ざり、
  // **自分たちが書いたメッセージを検査できなくなる**
  const emptyRecipe = {
    title: '',
    titleReading: '',
    description: '',
    ingredients: [],
    steps: [],
    tags: [],
  };
  const longFields = {
    ...emptyRecipe,
    title: 'あ'.repeat(101),
    ingredients: [{ groupLabel: '', name: 'あ'.repeat(51), amount: '', note: '' }],
    steps: [{ body: 'あ'.repeat(501) }],
  };
  const emptyRows = {
    ...emptyRecipe,
    title: 'テスト',
    ingredients: [{ groupLabel: '', name: '', amount: '', note: '' }],
    steps: [{ body: '' }],
  };

  it('スキーマのメッセージはすべて辞書のキーで、両ロケールで解決できる', () => {
    const messages = [emptyRecipe, longFields, emptyRows].flatMap((input) => {
      const result = recipeFormSchema.safeParse(input);
      expect(result.success).toBe(false);
      return (result as z.SafeParseError<unknown>).error.issues.map((issue) => issue.message);
    });
    // 8 種類すべてを踏むこと（踏まないと検査したことにならない）
    expect(new Set(messages).size).toBe(8);

    for (const locale of ['ja', 'en'] as const) {
      setLocale(locale);
      for (const message of messages) {
        const resolved = tDynamic(message);
        // 引けなかった場合 tDynamic はキーをそのまま返す
        expect(resolved).not.toBe(message);
        expect(resolved).not.toContain('missing');
      }
    }
  });

  it('辞書に無い文字列はそのまま返す（ライブラリ既定のメッセージを壊さない）', () => {
    expect(tDynamic('Expected string, received number')).toBe('Expected string, received number');
    expect(tDynamic(undefined)).toBeUndefined();
  });
});

describe('画面の見出しを日本語のまま出さない', () => {
  const JAPANESE = /[ぁ-んァ-ヶ一-龯]/;

  it('en ロケールでホームの文言に日本語が残っていない', () => {
    setLocale('en');
    const keys = [
      'home.filter.week',
      'home.filter.all',
      'home.loading',
      'home.capture',
      'home.wantTitle',
      'home.empty.allTitle',
      'home.empty.allMessage',
      'home.coach.fabTitle',
      'home.action.calendarLabel',
      'log.kind.eatenOut',
      'log.freeform',
      'common.save',
      'common.delete',
    ] as const;
    for (const key of keys) {
      expect(t(key)).not.toMatch(JAPANESE);
    }
  });
});
