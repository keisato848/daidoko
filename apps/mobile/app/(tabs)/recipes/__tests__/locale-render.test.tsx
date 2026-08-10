/**
 * 画面を**実際に描いて**、英語ロケールで日本語が出ないことを確かめる。
 *
 * 辞書の検査（`src/i18n/__tests__/dictionary.test.ts`）は辞書の中身しか見ない。
 * 画面に日本語を直書きした箇所や、`t()` を通していない値はそこでは捕まらない。
 * lint も既存コードには効くが、**描画時に組み立てられる文字列**は見えない。
 *
 * ここでは描画結果のテキストを全部集めて、en のときに日本語が混ざらないかを見る。
 * 端末での確認（文字あふれ・改行）は代わりにならないが、**訳し漏れ**はここで落ちる。
 */
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import ImportTextScreen from '../import-text';
import AddScreen from '../../add';
import { setLocale, SUPPORTED_LOCALES } from '../../../../src/i18n';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

const JAPANESE = /[ぁ-んァ-ヶ一-龯]/;

/** 描画結果に出ているテキストを全部集める。 */
function renderedTexts(element: ReactElement): string[] {
  render(element);
  return screen
    .UNSAFE_getAllByType(Text)
    .flatMap((node) =>
      Array.isArray(node.props.children) ? node.props.children : [node.props.children],
    )
    .filter((child): child is string => typeof child === 'string')
    .map((text) => text.trim())
    .filter(Boolean);
}

const SCREENS: [string, () => ReactElement][] = [
  ['テキストから作成', () => <ImportTextScreen />],
  ['追加方法の選択', () => <AddScreen />],
];

describe.each(SUPPORTED_LOCALES)('%s ロケールでの描画', (locale) => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(jest.fn());
    setLocale(locale);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    setLocale('ja');
  });

  it.each(SCREENS)('%s: 文言が空でなく、キー文字列が漏れていない', (_name, build) => {
    const texts = renderedTexts(build());
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      // 引けなかったキーは `[missing "en.foo.bar" translation]` として出る
      expect(text).not.toContain('missing');
      // キーをそのまま描いてしまった場合（tDynamic の引き忘れなど）
      expect(text).not.toMatch(/^[a-z]+(\.[a-zA-Z]+){2,}$/);
    }
  });

  it.each(SCREENS)('%s: en では日本語が出ない', (_name, build) => {
    const texts = renderedTexts(build());
    const japanese = texts.filter((text) => JAPANESE.test(text));
    if (locale === 'en') {
      expect(japanese).toEqual([]);
    } else {
      // ja では逆に、日本語が1つも出ていなければ配線ミス
      expect(japanese.length).toBeGreaterThan(0);
    }
  });
});
