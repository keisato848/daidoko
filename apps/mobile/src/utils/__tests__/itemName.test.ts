import { normalizeItemName } from '../itemName';

describe('normalizeItemName', () => {
  it('unifies katakana/hiragana, case, and trims', () => {
    expect(normalizeItemName('タマネギ')).toBe('たまねぎ');
    expect(normalizeItemName('  たまねぎ  ')).toBe('たまねぎ');
    expect(normalizeItemName('Milk')).toBe('milk');
  });

  it('unifies full-width / half-width via NFKC', () => {
    // full-width latin / digits → half-width
    expect(normalizeItemName('ＭＩＬＫ')).toBe('milk');
    // half-width katakana → full → hiragana
    expect(normalizeItemName('ﾀﾏﾈｷﾞ')).toBe(normalizeItemName('タマネギ'));
  });

  it('strips internal whitespace so spacing does not split a name', () => {
    expect(normalizeItemName('グリーン カレー')).toBe(normalizeItemName('グリーンカレー'));
    expect(normalizeItemName('鶏 もも 肉')).toBe('鶏もも肉');
  });

  it('returns empty string for blank input', () => {
    expect(normalizeItemName('   ')).toBe('');
  });
});
