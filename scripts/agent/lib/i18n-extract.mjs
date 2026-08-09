/**
 * 表示文言の抽出。**count-i18n-strings.mjs と i18n-strings.mjs で共有する**
 * （別々に持つと数がずれ、移行の進捗が信用できなくなる）。
 *
 * クォート内のリテラルだけを見ると **JSX のテキストノードを丸ごと落とす**。
 * 実際、ホーム画面の「削除」「再現したい」「すべて選択」などは
 * `<Text>…</Text>` の子で、初回の計測（697 件）から漏れていた。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const JAPANESE = /[ぁ-んァ-ヶ一-龯]/;

const SKIP_DIRS = new Set([
  'node_modules',
  '__tests__',
  'android',
  'ios',
  'assets',
  '.expo',
  'dist',
]);

/**
 * 翻訳対象外。**日本語そのものを処理するロジック**と、表示されないサンプルデータ。
 * これらは翻訳ではなく言語別の実装（設計 §7・P5）になる。
 */
export const EXCLUDED_FILES = new Set([
  'src/db/seed.ts', // サンプルデータ（EXPO_PUBLIC_ENABLE_SAMPLE_DATA が無ければ非表示）
  'src/e2e/photo-recipe-batch-fixtures.ts', // 評価用の期待値。ユーザーには出ない
  'src/constants/licenses.ts', // OSS ライセンス表記。翻訳しない
  'src/utils/receiptParser.ts', // 日本のレシート書式
  'src/utils/recipeTextParser.ts', // 日本語レシピ本文の解析
  'src/utils/recipeTextNormalizer.ts',
  'src/utils/stepTimer.ts', // 「10分」「1時間半」の抽出
  'src/utils/itemMatch.ts', // 食材の名寄せ
  'src/utils/itemName.ts',
  'src/utils/kana.ts', // かな正規化
  // 端末内フォールバック（ML Kit ラベル → 料理名）の日本語辞書。
  // 英語圏では辞書ごと作り直しになる（設計 §7・P5）
  'src/services/recipe-photo-inference.service.ts',
]);

/** 辞書そのものは対象外（日本語があって当然）。 */
export const IS_DICTIONARY = /^src\/i18n\//;

export function* walkSources(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      yield* walkSources(path);
    } else if (/\.tsx?$/.test(name)) {
      yield path;
    }
  }
}

/**
 * 1 行から表示文言を取り出す。
 *
 * 2 経路ある:
 *   1. クォート内のリテラル（`'保存'`、テンプレートリテラル）
 *   2. JSX のテキストノード（`<Text>削除</Text>` の「削除」）
 *
 * 2 は、タグと `{…}` を落とした残りに日本語があれば文言とみなす。
 * `{count}件選択中` のような**式と地の文の混在**もここで拾える。
 */
export function displayStringsIn(line) {
  const quoted = (line.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [])
    .map((literal) => literal.slice(1, -1))
    .filter((text) => JAPANESE.test(text));
  if (quoted.length > 0) return quoted;

  const stripped = line
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .trim();
  return JAPANESE.test(stripped) ? [stripped] : [];
}

/** コメントを除いた各行から、表示文言を行番号つきで返す。 */
export function extractFromSource(source) {
  const out = [];
  let inBlockComment = false;

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      return;
    }
    // `{/* … */}` は JSX 内のコメント。`/*` 判定だけでは先頭の `{` に阻まれて
    // 素通りし、コメント本文が文言として数えられていた
    if (line.startsWith('/*') || line.startsWith('{/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      return;
    }
    if (line.startsWith('//') || line.startsWith('*')) return;

    // 行末コメントを落とす（URL の // を巻き込むが、日本語判定には影響しない）
    const code = line.replace(/\/\/.*$/, '');
    for (const text of displayStringsIn(code)) out.push({ line: index + 1, text });
  });
  return out;
}

/** apps/mobile 配下の、翻訳対象ファイルと文言の一覧。 */
export function collectMobileStrings(mobileRoot) {
  const files = [];
  for (const file of walkSources(mobileRoot)) {
    const rel = relative(mobileRoot, file).replace(/\\/g, '/');
    if (EXCLUDED_FILES.has(rel) || IS_DICTIONARY.test(rel)) continue;
    const literals = extractFromSource(readFileSync(file, 'utf8'));
    if (literals.length > 0) files.push({ rel, literals });
  }
  return files;
}
