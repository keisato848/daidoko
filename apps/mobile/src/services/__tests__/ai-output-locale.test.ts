/**
 * AI の出力言語（BYOK 経路とサーバー経路の両方）。
 *
 * ここが抜けると **画面だけ英語で、返ってくるレシピは日本語**になる。
 * 英語版としては使えないので、機能の一部として固定しておく。
 */
import { setLocale } from '../../i18n';
import {
  outputLanguageInstruction,
  requestLocale,
  requestUnitSystem,
  unitSystemInstruction,
  withOutputLanguage,
  withUnitSystem,
} from '../ai-output-locale';
import { useUnitSystemStore } from '../../stores/unitSystem.store';

const JAPANESE = /[ぁ-んァ-ヶ一-龯]/;

afterEach(() => setLocale('ja'));

describe('requestLocale', () => {
  it('端末のロケールをそのまま送る', () => {
    setLocale('ja');
    expect(requestLocale()).toBe('ja');
    setLocale('en');
    expect(requestLocale()).toBe('en');
  });
});

describe('outputLanguageInstruction', () => {
  it('en の指示に日本語が混ざらない', () => {
    const instruction = outputLanguageInstruction('en');
    expect(instruction).not.toMatch(JAPANESE);
    expect(instruction.toLowerCase()).toContain('english');
  });

  it('en では先の「日本語で出力」を打ち消すと明示する', () => {
    expect(outputLanguageInstruction('en').toLowerCase()).toContain('overrides');
  });

  it('ja は日本語で出すよう指示する', () => {
    expect(outputLanguageInstruction('ja')).toContain('日本語');
  });
});

describe('withOutputLanguage', () => {
  const base = 'あなたは料理写真からレシピを再現する、日本語のプロの料理人です。';

  it('元のプロンプトを壊さず、末尾に足すだけ', () => {
    expect(withOutputLanguage(base, 'en')).toContain(base);
    expect(withOutputLanguage(base, 'en').trimEnd()).toMatch(/note\.$/);
  });

  it('引数を省略すると現在のロケールに従う', () => {
    setLocale('en');
    expect(withOutputLanguage(base)).toBe(withOutputLanguage(base, 'en'));
    setLocale('ja');
    expect(withOutputLanguage(base)).toBe(withOutputLanguage(base, 'ja'));
  });

  /**
   * サーバー側 `apps/server/src/lib/output-locale.ts` と**同じ文面**であること。
   * 片方だけ直すと、BYOK とサーバーで返る言語が食い違う。
   */
  it('BYOK とサーバーで同じ指示になるよう、既知の文面を含む', () => {
    const instruction = outputLanguageInstruction('en');
    expect(instruction).toContain('Output language (overrides any earlier instruction');
    expect(instruction).toContain('Do not output Japanese.');
  });
});

describe('単位系（P1）', () => {
  const base = 'あなたは料理写真からレシピを再現する、日本語のプロの料理人です。';

  afterEach(() => useUnitSystemStore.getState().setSystemForTesting('metric'));

  it('設定をそのまま送る', () => {
    useUnitSystemStore.getState().setSystemForTesting('imperial');
    expect(requestUnitSystem()).toBe('imperial');
    useUnitSystemStore.getState().setSystemForTesting('metric');
    expect(requestUnitSystem()).toBe('metric');
  });

  it('メートル法ではプロンプトを変えない（既存の測定を無効にしない）', () => {
    expect(withUnitSystem(base, 'metric')).toBe(base);
    expect(unitSystemInstruction('metric')).toBe('');
  });

  it('ヤード・ポンド法では末尾に指示を足す', () => {
    const result = withUnitSystem(base, 'imperial');
    expect(result.startsWith(base)).toBe(true);
    expect(result).toContain('US customary units');
    expect(result).toContain('Fahrenheit');
    // プロンプト本体は日本語のまま。足す指示だけが英語であることを見る
    expect(unitSystemInstruction('imperial')).not.toMatch(JAPANESE);
  });

  it('単位の指示は言語の指示より後ろに置く（直近の指示ほど効く）', () => {
    const composed = withUnitSystem(withOutputLanguage(base, 'en'), 'imperial');
    expect(composed.indexOf('Output language')).toBeLessThan(composed.indexOf('## Units'));
  });
});
