/**
 * A 階層の**意味の同一性**を検査する（`docs/多言語対応設計.md` §6-5）。
 *
 * 型は「キーが揃っているか」しか見ない。空文字でも、意味の違う文でも型は通る。
 * ここで守るのは「**訳したら意味が変わっていた**」を機械で落とすこと。
 *
 * 重要: 期待キーワードは**辞書と別ファイル**（`../expectations.ts`）に置く。
 * `__tests__/` に置くと Jest がテストファイルとして拾って落ちるため、外に出している。
 * 同じファイルに置くと、翻訳を直すときに期待値も一緒に直してしまい、検査が意味を失う。
 */
import en from '../locales/en';
import ja from '../locales/ja';
import { isCriticalMessage } from '../types';
import { EXPECTED_KEYWORDS, FORBIDDEN_PATTERNS } from '../expectations';

const LOCALES = { ja, en } as const;
type LocaleName = keyof typeof LOCALES;
const LOCALE_NAMES = Object.keys(LOCALES) as LocaleName[];

/** ネストした辞書から `{ text, intent }` を持つものを平坦に集める。 */
function collectCritical(
  node: unknown,
  path: string[] = [],
): Map<string, { text: string; intent: string }> {
  const out = new Map<string, { text: string; intent: string }>();
  if (isCriticalMessage(node)) {
    out.set(path.join('.'), node);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      for (const [k, v] of collectCritical(child, [...path, key])) out.set(k, v);
    }
  }
  return out;
}

describe('A 階層の構造', () => {
  it('ja と en で A 階層のキーが一致する', () => {
    expect([...collectCritical(en).keys()].sort()).toEqual([...collectCritical(ja).keys()].sort());
  });

  it.each(LOCALE_NAMES)(
    '%s: すべての A 階層に text と intent がある（空文字を許さない）',
    (name) => {
      for (const [key, msg] of collectCritical(LOCALES[name])) {
        // 型は空文字を許すので、ここで落とす
        expect(`${name}.${key}.text=${msg.text.trim()}`).not.toBe(`${name}.${key}.text=`);
        expect(`${name}.${key}.intent=${msg.intent.trim()}`).not.toBe(`${name}.${key}.intent=`);
      }
    },
  );

  it('intent は ja と en で同一（翻訳対象ではなく、翻訳者への指示のため）', () => {
    const jaAll = collectCritical(ja);
    for (const [key, msg] of collectCritical(en)) {
      expect(`${key}: ${msg.intent}`).toBe(`${key}: ${jaAll.get(key)?.intent}`);
    }
  });
});

describe.each(LOCALE_NAMES)('%s: 意味の同一性', (name) => {
  const dict = collectCritical(LOCALES[name]);
  const text = (key: string): string => {
    const found = dict.get(key);
    if (!found) throw new Error(`キーがない: ${key}`);
    return found.text;
  };

  // ── 区別が消えていないか（#120 で作った分離） ──────────────────────────
  it('オフライン / 枠切れ / 混雑 が互いに違う文言である', () => {
    const messages = [text('error.offline'), text('error.quotaExceeded'), text('error.transient')];
    // 同じ文言が混ざっていれば集合が縮む
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('オフラインは「再接続」を促す', () => {
    expect(text('error.offline')).toMatch(EXPECTED_KEYWORDS[name].reconnect);
  });

  it('枠切れは「待つ」ことを伝える（再接続を促さない）', () => {
    expect(text('error.quotaExceeded')).toMatch(EXPECTED_KEYWORDS[name].wait);
    // 枠切れなのに再接続を促すと、オフラインと混同される
    expect(text('error.quotaExceeded')).not.toMatch(EXPECTED_KEYWORDS[name].reconnect);
  });

  it('オフラインは枠切れと混同されない（上限に言及しない）', () => {
    expect(text('error.offline')).not.toMatch(EXPECTED_KEYWORDS[name].limit);
  });

  // ── 保証が弱まっていないか（R2 の安全装置） ────────────────────────────
  it('R2 の保証文が断定である（可能性の表現に弱められていない）', () => {
    const guarantee = text('recipe.refine.diffGuarantee');
    expect(guarantee).toMatch(EXPECTED_KEYWORDS[name].unchanged);
    for (const forbidden of FORBIDDEN_PATTERNS[name].hedging) {
      // 保証が可能性の表現で弱められていないか。
      // 失敗時にどのパターンかを見るため、パターンは describe 名ではなく
      // ここでループしている（文字列に混ぜると自己マッチするので混ぜない）
      expect(guarantee).not.toMatch(forbidden);
    }
  });
});
