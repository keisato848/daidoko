/**
 * 移行作業の道具。**どの文言がどこにあるか**を機械的に出す。
 * 設計は `docs/多言語対応設計.md` §9（移行の順序）。
 *
 * 数を測るのは count-i18n-strings.mjs、こちらは**実際に置き換える文言を出す**。
 * 目で追うと必ず取りこぼすので、移行の前後で必ずこれを通す。
 *
 * 使い方:
 *   node scripts/agent/i18n-strings.mjs --file app/(tabs)/settings.tsx   # そのファイルの一覧
 *   node scripts/agent/i18n-strings.mjs --dupes                          # 複数ファイルに出る文言（common 候補）
 *   node scripts/agent/i18n-strings.mjs --remaining                      # 未移行のファイルを多い順に
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MOBILE_ROOT = join(REPO_ROOT, 'apps', 'mobile');
const JAPANESE = /[ぁ-んァ-ヶ一-龯]/;
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
 * 翻訳対象外。**日本語そのものを処理するロジック**とサンプルデータ。
 * count-i18n-strings.mjs の EXCLUDED と揃えること（数が合わなくなる）。
 */
const EXCLUDED = new Set([
  'src/db/seed.ts',
  'src/e2e/photo-recipe-batch-fixtures.ts',
  'src/constants/licenses.ts',
  'src/utils/receiptParser.ts',
  'src/utils/recipeTextParser.ts',
  'src/utils/recipeTextNormalizer.ts',
  'src/utils/stepTimer.ts',
  'src/utils/itemMatch.ts',
  'src/utils/itemName.ts',
  'src/utils/kana.ts',
  'src/services/recipe-photo-inference.service.ts',
]);

/** 辞書そのものは対象外（日本語があって当然）。 */
const IS_DICTIONARY = /^src\/i18n\//;

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

/** コメントを除いた各行から、日本語を含む文字列リテラルを行番号つきで返す。 */
function literalsWithLines(source) {
  const out = [];
  let inBlockComment = false;

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      return;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      return;
    }
    if (line.startsWith('//') || line.startsWith('*')) return;

    const code = line.replace(/\/\/.*$/, '');
    for (const literal of code.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? []) {
      if (JAPANESE.test(literal)) out.push({ line: index + 1, text: literal.slice(1, -1) });
    }
  });
  return out;
}

function collect() {
  const files = [];
  for (const file of walk(MOBILE_ROOT)) {
    const rel = relative(MOBILE_ROOT, file).replace(/\\/g, '/');
    if (EXCLUDED.has(rel) || IS_DICTIONARY.test(rel)) continue;
    const literals = literalsWithLines(readFileSync(file, 'utf8'));
    if (literals.length > 0) files.push({ rel, literals });
  }
  return files;
}

const args = process.argv.slice(2);
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

if (fileArg) {
  const target = fileArg.replace(/\\/g, '/').replace(/^apps\/mobile\//, '');
  const match = collect().find((f) => f.rel === target);
  if (!match) {
    console.log(`該当なし（すでに移行済み、または対象外）: ${target}`);
    process.exit(0);
  }
  console.log(`${match.rel} — ${match.literals.length} 件\n`);
  for (const { line, text } of match.literals) {
    console.log(`  ${String(line).padStart(4)}  ${text}`);
  }
} else if (args.includes('--dupes')) {
  const freq = new Map();
  for (const { rel, literals } of collect()) {
    for (const { text } of literals) {
      if (!freq.has(text)) freq.set(text, new Set());
      freq.get(text).add(rel);
    }
  }
  const shared = [...freq]
    .filter(([, files]) => files.size >= 2)
    .sort((a, b) => b[1].size - a[1].size);
  console.log(`複数ファイルに出る文言（common 名前空間の候補）: ${shared.length} 件\n`);
  for (const [text, files] of shared) {
    console.log(`  ${String(files.size).padStart(2)}  ${text}`);
  }
} else {
  const files = collect().sort((a, b) => b.literals.length - a.literals.length);
  const total = files.reduce((sum, f) => sum + f.literals.length, 0);
  console.log(`未移行: ${total} 件 / ${files.length} ファイル\n`);
  for (const { rel, literals } of files) {
    console.log(`  ${String(literals.length).padStart(4)}  ${rel}`);
  }
}
