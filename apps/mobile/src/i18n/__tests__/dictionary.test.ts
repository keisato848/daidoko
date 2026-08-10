/**
 * 辞書そのものの検査。**全件**を対象にする。
 *
 * 949 件を手で移した以上、抜け・貼り間違い・訳し忘れは必ず出る。
 * 目視では見つからないので、辞書を丸ごと歩いて機械的に落とす。
 */
import { en, ja, resolveLocale } from '../index';
import { isCriticalMessage } from '../types';

const JAPANESE = /[ぁ-んァ-ヶ一-龯]/;

/**
 * 端末の言語タグからロケールを決める部分。
 *
 * **実機で英語表示にならない不具合は、ほぼここで起きる。** 端末が返すタグは
 * `en-US` `ja-JP` `en-GB` のように地域つきで、素朴に一致を見ると全部外れる。
 */
describe('resolveLocale（端末の言語タグ）', () => {
  it('地域つきのタグを言語に寄せる', () => {
    expect(resolveLocale(['en-US'])).toBe('en');
    expect(resolveLocale(['en-GB'])).toBe('en');
    expect(resolveLocale(['ja-JP'])).toBe('ja');
    expect(resolveLocale(['EN-us'])).toBe('en'); // 大文字で返す端末がある
  });

  it('対応していない言語は ja に倒す', () => {
    // 半端な英語を出すより、日本語で一貫させる（§3 の判断）
    expect(resolveLocale(['fr-FR'])).toBe('ja');
    expect(resolveLocale([])).toBe('ja');
  });

  it('複数言語が設定されているときは、対応する最初のものを採る', () => {
    expect(resolveLocale(['fr-FR', 'en-US', 'ja-JP'])).toBe('en');
    expect(resolveLocale(['ko-KR', 'ja-JP'])).toBe('ja');
  });
});

/** 辞書を歩いて `[キーのパス, 文字列]` を全部返す。 */
function walk(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    walk(value, prefix ? `${prefix}.${key}` : key),
  );
}

/** `intent` は翻訳者への指示なので、文言の検査からは除く。 */
const isIntent = (path: string): boolean => path.endsWith('.intent');

const jaEntries = walk(ja).filter(([path]) => !isIntent(path));
const enEntries = walk(en).filter(([path]) => !isIntent(path));

describe('辞書の対応', () => {
  it('ja と en のキーが完全に一致する', () => {
    // 型でも落ちるが、実行時にも確かめる（型は構造だけで中身を見ない）
    expect(enEntries.map(([path]) => path).sort()).toEqual(jaEntries.map(([path]) => path).sort());
  });

  it('空文字の文言が無い（型では通ってしまう）', () => {
    for (const [path, text] of [...jaEntries, ...enEntries]) {
      expect([path, text.trim()]).not.toEqual([path, '']);
    }
  });
});

describe('en 辞書に日本語が残っていない', () => {
  it('すべての英語文言が日本語を含まない', () => {
    const leaked = enEntries.filter(([, text]) => JAPANESE.test(text));
    // 落ちたときにどのキーかが分かるように、パスごと出す
    expect(leaked.map(([path]) => path)).toEqual([]);
  });

  /**
   * 意図的に ja と en が同じもの。**増やすときは理由を書くこと** —
   * 「まだ訳していないだけ」をここに逃がすと、検査が意味を失う。
   */
  const INTENTIONALLY_IDENTICAL = new Set([
    'common.ok', // 「OK」は日本語でもそのまま使う
  ]);

  it('en が ja の丸写しになっていない（訳し忘れの検出）', () => {
    const jaByPath = new Map(jaEntries);
    const copied = enEntries.filter(([path, text]) => {
      if (INTENTIONALLY_IDENTICAL.has(path)) return false;
      const original = jaByPath.get(path);
      if (original === undefined) return false;
      // 記号だけ・数字だけの文言（区切り、`{{count}}` のみ等）は一致してよい
      if (!/[A-Za-z぀-鿿]/.test(original)) return false;
      return original === text;
    });
    expect(copied.map(([path]) => path)).toEqual([]);
  });
});

describe('補間の記法', () => {
  it('ja と en で {{変数}} の集合が一致する', () => {
    const placeholders = (text: string): string[] =>
      (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((m) => m.replace(/[{}\s]/g, '')).sort();

    const jaByPath = new Map(jaEntries);
    const mismatched: string[] = [];
    for (const [path, text] of enEntries) {
      const original = jaByPath.get(path);
      if (original === undefined) continue;
      // 変数名が違うと、その文言だけ差し込みが空になる
      if (placeholders(original).join(',') !== placeholders(text).join(',')) {
        mismatched.push(path);
      }
    }
    expect(mismatched).toEqual([]);
  });
});

describe('A 階層', () => {
  const criticalPaths = (dictionary: unknown): string[] => {
    const out: string[] = [];
    const visit = (node: unknown, prefix: string): void => {
      if (isCriticalMessage(node)) {
        out.push(prefix);
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        visit(value, prefix ? `${prefix}.${key}` : key);
      }
    };
    visit(dictionary, '');
    return out.sort();
  };

  it('ja と en で A 階層の位置が一致する（片方だけ intent が落ちていない）', () => {
    expect(criticalPaths(en)).toEqual(criticalPaths(ja));
  });

  it('A 階層は 1 件以上あり、intent が空でない', () => {
    const paths = criticalPaths(ja);
    expect(paths.length).toBeGreaterThan(0);
    for (const [path, text] of walk(ja).filter(([p]) => isIntent(p))) {
      expect([path, text.trim().length > 20]).toEqual([path, true]);
    }
  });
});
