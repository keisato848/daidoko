/**
 * Kana normalization utility
 * Converts katakana to hiragana and lowercases for consistent search
 */

/**
 * Convert katakana characters to hiragana.
 * U+30A1..U+30F6 -> U+3041..U+3096
 */
export function katakanaToHiragana(text: string): string {
  return text.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * Normalize text for search: katakana -> hiragana, lowercase, trim
 */
export function normalizeKana(text: string): string {
  return katakanaToHiragana(text.trim()).toLowerCase();
}
