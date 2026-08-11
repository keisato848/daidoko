/**
 * 単位系の指示（P1）。**メートル法では既存のプロンプトを一切変えない**ことを固定する
 * — 変えると `docs/レシピ推論の評価設計.md` の測定が無効になり、いまの利用者の
 * 出力も変わってしまう。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_UNIT_SYSTEM,
  parseUnitSystem,
  unitSystemInstruction,
  withUnitSystem,
} from '../output-locale.js';

describe('parseUnitSystem', () => {
  it('imperial だけを受け付け、他は既定（metric）', () => {
    expect(parseUnitSystem('imperial')).toBe('imperial');
    expect(parseUnitSystem('metric')).toBe('metric');
    expect(parseUnitSystem(undefined)).toBe(DEFAULT_UNIT_SYSTEM);
    expect(parseUnitSystem('IMPERIAL')).toBe(DEFAULT_UNIT_SYSTEM);
    expect(parseUnitSystem(1)).toBe(DEFAULT_UNIT_SYSTEM);
  });
});

describe('withUnitSystem', () => {
  const prompt = '料理の写真からレシピを起こす。';

  it('メートル法ではプロンプトを変えない', () => {
    expect(withUnitSystem(prompt, 'metric')).toBe(prompt);
    expect(unitSystemInstruction('metric')).toBe('');
  });

  it('ヤード・ポンド法では末尾に指示を足す', () => {
    const result = withUnitSystem(prompt, 'imperial');
    expect(result.startsWith(prompt)).toBe(true);
    expect(result).toContain('US customary units');
    expect(result).toContain('Fahrenheit');
    // 直近の指示ほど効くので、必ず末尾に置く
    expect(result.trimEnd().endsWith('Do not also list metric values.')).toBe(true);
  });
});
