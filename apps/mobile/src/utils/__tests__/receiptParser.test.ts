import { parseReceipt } from '../receiptParser';

const SAMPLE = `スーパーだいどこ
2026年6月30日 19:23
ﾆﾝｼﾞﾝ          ¥128
ｷｭｳﾘ 3本       ¥158
牛乳           218円
食パン         ＊158
たまご 1ﾊﾟｯｸ   ¥258
小計          ¥920
消費税        ¥73
合計         ¥993
お預り       ¥1000
お釣り        ¥7
ポイント       9P
TEL 03-1234-5678`;

describe('parseReceipt', () => {
  const items = parseReceipt(SAMPLE);
  const names = items.map((i) => i.name);

  it('keeps product lines, stripping price + quantity + tax marks', () => {
    expect(names).toContain('ﾆﾝｼﾞﾝ');
    expect(names).toContain('ｷｭｳﾘ'); // "3本" stripped
    expect(names).toContain('牛乳');
    expect(names).toContain('食パン'); // "＊" stripped
    expect(names).toContain('たまご'); // "1ﾊﾟｯｸ" stripped
  });

  it('extracts the price', () => {
    expect(items.find((i) => i.name === '牛乳')?.price).toBe(218);
    expect(items.find((i) => i.name === 'ﾆﾝｼﾞﾝ')?.price).toBe(128);
  });

  it('excludes totals / tax / change / points', () => {
    for (const kw of ['小計', '合計', '消費税', 'お釣', 'お預', 'ポイント']) {
      expect(names.some((n) => n.includes(kw))).toBe(false);
    }
  });

  it('excludes mostly-digit lines (date, phone)', () => {
    expect(names.some((n) => n.includes('2026'))).toBe(false);
    expect(names.some((n) => n.includes('1234'))).toBe(false);
  });

  it('returns empty for blank input', () => {
    expect(parseReceipt('')).toEqual([]);
    expect(parseReceipt('   \n  ')).toEqual([]);
  });

  it('drops receipt metadata noise (invoice number, register, qty fragments)', () => {
    const noise = parseReceipt(
      '事業者番号 T1234567890123\n責1512セルフ\n2コX単 98\n単価 100\nレタス 158',
    );
    const n = noise.map((i) => i.name);
    expect(n).toContain('レタス');
    expect(n.some((x) => x.includes('事業者番号'))).toBe(false);
    expect(n.some((x) => x.includes('責'))).toBe(false);
    expect(n.some((x) => x.includes('単価'))).toBe(false);
    expect(n.some((x) => x.startsWith('2コX'))).toBe(false);
  });
});
