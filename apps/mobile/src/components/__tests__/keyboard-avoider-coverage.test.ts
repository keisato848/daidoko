/**
 * 入力欄のある画面が KeyboardAvoider で包まれていることの横断チェック（#172）。
 *
 * `KeyboardAvoider.tsx` の冒頭には「入力欄のある画面は必ずこれで包む」と書いてあるが、
 * 規約を文章で書いただけでは守られなかった — 主役機能の「写真からレシピ」を含む 5 画面が
 * 包まれておらず、キーボードが下部のボタンを覆って押せない状態で出荷されていた。
 * 人力の棚卸しに戻さないよう、ここで機械的に見張る。
 *
 * 落ちたときは、まず**包む**こと。包まないと決めたなら EXEMPT に理由を書く。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP_DIR = resolve(__dirname, '../../../app');

/** KeyboardAvoider で包まない画面と、その理由。無条件に足さないこと。 */
const EXEMPT: Record<string, string> = {
  '(tabs)/recipes/index.tsx':
    '検索欄は画面の最上部にあり、その下にボタンが無い（隠れて困る操作が無い）。' +
    'それに対して包むと最下部の AdBanner がキーボードの直上へ押し上げられ、' +
    '誤タップを誘発する。代わりに FlatList へ keyboardShouldPersistTaps を入れてある。',
};

function collectScreens(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      collectScreens(full, acc);
    } else if (entry.name.endsWith('.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

/** 画面パスを app/ からの相対（POSIX 区切り）で表す。EXEMPT のキーと揃える。 */
function screenKey(fullPath: string): string {
  return fullPath
    .slice(APP_DIR.length + 1)
    .split(/[\\/]/)
    .join('/');
}

const screens = collectScreens(APP_DIR).map((path) => ({
  key: screenKey(path),
  source: readFileSync(path, 'utf8'),
}));

const withInput = screens.filter((screen) => screen.source.includes('<TextInput'));

describe('KeyboardAvoider coverage', () => {
  it('走査対象の画面を実際に見つけている（パス解決が壊れたら気づく）', () => {
    expect(screens.length).toBeGreaterThan(20);
    expect(withInput.length).toBeGreaterThan(10);
  });

  it.each(withInput.map((screen) => screen.key))(
    '%s は KeyboardAvoider で包まれている（または理由つきで除外されている）',
    (key) => {
      const screen = withInput.find((candidate) => candidate.key === key);
      if (EXEMPT[key]) return; // 理由は EXEMPT に記録済み
      expect(screen?.source).toMatch(/from '.*components\/KeyboardAvoider'/);
    },
  );

  it('EXEMPT に、もう入力欄が無い画面や消えた画面が残っていない', () => {
    for (const key of Object.keys(EXEMPT)) {
      expect(withInput.map((screen) => screen.key)).toContain(key);
    }
  });

  it('Modal の中の入力欄には、モーダル内側にも KeyboardAvoider が要る', () => {
    // 画面全体を包んでも Modal の中身は別ツリーなので効かない。#172 の報告箇所。
    const importPhoto = withInput.find((s) => s.key === '(tabs)/recipes/import-photo.tsx');
    if (!importPhoto) throw new Error('import-photo.tsx が見つからない（走査対象から外れた？）');
    const modalBlock = importPhoto.source.slice(importPhoto.source.indexOf('<Modal'));
    expect(modalBlock).toContain('<KeyboardAvoider');
  });
});
