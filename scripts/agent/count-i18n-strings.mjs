/**
 * 多言語対応の規模を測る（`docs/多言語対応設計.md` §2 の数字の根拠）。
 *
 * 素朴に日本語文字を grep すると **2,883 箇所**出るが、これは過大。
 * 大半がコメントと、日本語そのものを処理するロジック（正規表現・辞書）で、
 * どちらも翻訳の対象ではない。
 *
 * ここでは「翻訳が要る表示文言」だけを数える。抽出は lib/i18n-extract.mjs
 * （クォート内リテラル ＋ JSX テキストノード）。**JSX を数えないと過少になる** —
 * 初回の計測はそれで 697 件と出していた。
 *
 * 使い方:
 *   node scripts/agent/count-i18n-strings.mjs
 *   node scripts/agent/count-i18n-strings.mjs --files          # ファイル別（上位30）
 *   node scripts/agent/count-i18n-strings.mjs --files --all    # ファイル別（全件）
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectMobileStrings } from './lib/i18n-extract.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MOBILE_ROOT = join(REPO_ROOT, 'apps', 'mobile');
const showFiles = process.argv.includes('--files');

function layerOf(relativePath) {
  if (relativePath.startsWith('app/')) return '画面 (app/)';
  if (relativePath.startsWith('src/components')) return 'コンポーネント';
  if (relativePath.startsWith('src/services')) return 'サービス（エラー文言など）';
  if (relativePath.startsWith('src/utils')) return 'ユーティリティ';
  if (relativePath.startsWith('src/db')) return 'DB';
  return 'その他';
}

const files = collectMobileStrings(MOBILE_ROOT);
const byLayer = new Map();
let total = 0;

for (const { rel, literals } of files) {
  const layer = layerOf(rel);
  byLayer.set(layer, (byLayer.get(layer) ?? 0) + literals.length);
  total += literals.length;
}

console.log('翻訳対象になりうる表示文言（コメント除外・リテラル ＋ JSX テキスト）\n');
for (const [layer, count] of [...byLayer].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${layer.padEnd(28)}${String(count).padStart(5)}`);
}
console.log(`  ${'合計'.padEnd(28)}${String(total).padStart(5)}`);
console.log(`\n  ${files.length} ファイル（日本語処理ロジック・サンプルデータ・辞書は除外）`);

if (showFiles) {
  // 移行の計画には**全件**が要る（上位だけ見ると尻尾を数え落とす）
  const all = process.argv.includes('--all');
  const rows = [...files].sort((a, b) => b.literals.length - a.literals.length);
  const shown = all ? rows : rows.slice(0, 30);
  console.log(`\nファイル別（${all ? `全 ${rows.length} ファイル` : '上位30'}）`);
  for (const { rel, literals } of shown) {
    console.log(`  ${String(literals.length).padStart(4)}  ${rel}`);
  }
}
