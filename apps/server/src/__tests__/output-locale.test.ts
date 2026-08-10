/**
 * AI の出力言語。**画面だけ英語で中身が日本語**という状態を防ぐための検査。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OUTPUT_LOCALE,
  outputLanguageInstruction,
  parseOutputLocale,
  withOutputLanguage,
} from '../lib/output-locale.js';
import { buildSystemPrompt } from '../lib/vision-recipe.js';

const JAPANESE = /[ぁ-んァ-ヶ一-龯]/;

describe('parseOutputLocale', () => {
  it('en だけを en として受け、それ以外は既定（ja）に倒す', () => {
    expect(parseOutputLocale('en')).toBe('en');
    expect(parseOutputLocale('ja')).toBe('ja');
    // 未知の値で英語が漏れないこと。既定は必ず ja
    expect(parseOutputLocale('fr')).toBe(DEFAULT_OUTPUT_LOCALE);
    expect(parseOutputLocale(undefined)).toBe(DEFAULT_OUTPUT_LOCALE);
    expect(parseOutputLocale(null)).toBe(DEFAULT_OUTPUT_LOCALE);
    expect(parseOutputLocale(42)).toBe(DEFAULT_OUTPUT_LOCALE);
  });
});

describe('outputLanguageInstruction', () => {
  it('en の指示に日本語が混ざらない', () => {
    const instruction = outputLanguageInstruction('en');
    expect(instruction).not.toMatch(JAPANESE);
    expect(instruction.toLowerCase()).toContain('english');
  });

  it('en では「日本語で出力」を打ち消すと明示する', () => {
    // プロンプト本体は日本語のままなので、**あとから上書きする**ことを
    // 書いておかないとモデルが従わないことがある
    expect(outputLanguageInstruction('en').toLowerCase()).toContain('overrides');
  });

  it('ja は日本語で出すよう指示する', () => {
    expect(outputLanguageInstruction('ja')).toContain('日本語');
  });
});

describe('buildSystemPrompt', () => {
  it('locale を省略すると ja（既存の呼び出しは挙動が変わらない）', () => {
    expect(buildSystemPrompt('v1')).toBe(buildSystemPrompt('v1', 'ja'));
  });

  it('v0 / v1 のどちらでも en の指示が末尾に付く', () => {
    for (const variant of ['v0', 'v1'] as const) {
      const prompt = buildSystemPrompt(variant, 'en');
      expect(prompt).toContain(outputLanguageInstruction('en'));
      // 本体は日本語のまま（v1 は日本語で品質を測ってあるため）
      expect(prompt).toMatch(JAPANESE);
      // 指示は末尾に置く（直近の指示ほど効きやすい）
      expect(prompt.trimEnd().endsWith(outputLanguageInstruction('en').trimEnd())).toBe(true);
    }
  });
});

describe('withOutputLanguage', () => {
  it('元のプロンプトを壊さず、末尾に足すだけ', () => {
    const base = 'あなたは料理人です。';
    expect(withOutputLanguage(base, 'en')).toContain(base);
    expect(withOutputLanguage(base, 'ja')).toContain(base);
  });
});
