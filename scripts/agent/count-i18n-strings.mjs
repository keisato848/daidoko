/**
 * 多言語対応の規模を測る（`docs/多言語対応設計.md` §2 の数字の根拠）。
 *
 * 素朴に日本語文字を grep すると **2,883 箇所**出るが、これは過大。
 * 大半がコメントと、日本語そのものを処理するロジック（正規表現・辞書）で、
 * どちらも翻訳の対象ではない。
 *
 * ここでは「翻訳が要る表示文言」だけを数える:
 *   - コメント（行・ブロック・行末）を除く
 *   - クォート内の文字列リテラルに限る
 *   - 日本語処理ロジックとサンプルデータを除外リストで落とす
 *
 * 使い方:
 *   node scripts/agent/count-i18n-strings.mjs
 *   node scripts/agent/count-i18n-strings.mjs --files   # ファイル別の内訳も出す
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MOBILE_ROOT = join(REPO_ROOT, 'apps', 'mobile');
const JAPANESE = /[ぁ-んァ-ヶ一-龯]/;
const showFiles = process.argv.includes('--files');

/**
 * 翻訳対象外。**日本語そのものを処理するロジック**と、表示されないサンプルデータ。
 * これらは翻訳ではなく言語別の実装（設計 §7・P5）になる。
 */
const EXCLUDED = new Set([
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

const SKIP_DIRS = new Set(['node_modules', '__tests__', 'android', 'ios', 'assets', '.expo']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      yield* walk(path);
    } else if (/\.tsx?$/.test(name)) {
      yield path;
    }
  }
}

/** コメントを除いたうえで、日本語を含む文字列リテラルの数を返す。 */
function countDisplayStrings(source) {
  let inBlockComment = false;
  let count = 0;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('*')) continue;

    // 行末コメントを落とす（URL の // を巻き込むが、日本語判定には影響しない）
    const code = line.replace(/\/\/.*$/, '');
    const literals = code.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
    for (const literal of literals) if (JAPANESE.test(literal)) count += 1;
  }
  return count;
}

function layerOf(relativePath) {
  if (relativePath.startsWith('app/')) return '画面 (app/)';
  if (relativePath.startsWith('src/components')) return 'コンポーネント';
  if (relativePath.startsWith('src/services')) return 'サービス（エラー文言など）';
  if (relativePath.startsWith('src/utils')) return 'ユーティリティ';
  if (relativePath.startsWith('src/db')) return 'DB';
  return 'その他';
}

const byLayer = new Map();
const byFile = [];
let total = 0;
let excluded = 0;

for (const file of walk(MOBILE_ROOT)) {
  const rel = relative(MOBILE_ROOT, file).replace(/\\/g, '/');
  const count = countDisplayStrings(readFileSync(file, 'utf8'));
  if (count === 0) continue;

  if (EXCLUDED.has(rel)) {
    excluded += count;
    continue;
  }
  const layer = layerOf(rel);
  byLayer.set(layer, (byLayer.get(layer) ?? 0) + count);
  byFile.push({ rel, count });
  total += count;
}

console.log('翻訳対象になりうる表示文言（コメント除外・クォート内のみ）\n');
for (const [layer, count] of [...byLayer].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${layer.padEnd(28)}${String(count).padStart(5)}`);
}
console.log(`  ${'合計'.padEnd(28)}${String(total).padStart(5)}`);
console.log(`\n  除外（日本語処理ロジック・サンプルデータ）: ${excluded}`);

if (showFiles) {
  console.log('\nファイル別（上位30）');
  for (const { rel, count } of byFile.sort((a, b) => b.count - a.count).slice(0, 30)) {
    console.log(`  ${String(count).padStart(4)}  ${rel}`);
  }
}
