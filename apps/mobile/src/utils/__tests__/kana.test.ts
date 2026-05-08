import { katakanaToHiragana, normalizeKana } from '../kana';

describe('kana', () => {
  describe('katakanaToHiragana', () => {
    it('converts katakana to hiragana', () => {
      expect(katakanaToHiragana('カタカナ')).toBe('かたかな');
    });

    it('leaves hiragana unchanged', () => {
      expect(katakanaToHiragana('ひらがな')).toBe('ひらがな');
    });

    it('leaves kanji unchanged', () => {
      expect(katakanaToHiragana('漢字')).toBe('漢字');
    });

    it('handles mixed text', () => {
      expect(katakanaToHiragana('カレーうどん')).toBe('かれーうどん');
    });

    it('handles empty string', () => {
      expect(katakanaToHiragana('')).toBe('');
    });

    it('handles ASCII characters', () => {
      expect(katakanaToHiragana('ABC')).toBe('ABC');
    });
  });

  describe('normalizeKana', () => {
    it('converts katakana and lowercases', () => {
      expect(normalizeKana('カレー')).toBe('かれー');
    });

    it('lowercases ASCII', () => {
      expect(normalizeKana('ABC')).toBe('abc');
    });

    it('trims whitespace', () => {
      expect(normalizeKana('  テスト  ')).toBe('てすと');
    });

    it('handles mixed content', () => {
      expect(normalizeKana('ハンバーグ肉')).toBe('はんばーぐ肉');
    });
  });
});
