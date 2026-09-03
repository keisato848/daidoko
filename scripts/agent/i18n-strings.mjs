/**
 * 移行作業の道具。**どの文言がどこにあるか**を機械的に出す。
 * 設計は `docs/多言語対応設計.md` §9（移行の順序）。
 *
 * 数を測るのは count-i18n-strings.mjs、こちらは**実際に置き換える文言を出す**。
 * 抽出ロジックは lib/i18n-extract.mjs で共有している（別々に持つと数がずれる）。
 * 目で追うと必ず取りこぼすので、移行の前後で必ずこれを通す。
 *
 * 使い方:
 *   node scripts/agent/i18n-strings.mjs --file "app/settings.tsx"   # そのファイルの一覧
 *   node scripts/agent/i18n-strings.mjs --dupes                            # 複数ファイルに出る文言（common 候補）
 *   node scripts/agent/i18n-strings.mjs                                    # 未移行のファイルを多い順に
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectMobileStrings } from './lib/i18n-extract.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MOBILE_ROOT = join(REPO_ROOT, 'apps', 'mobile');

const args = process.argv.slice(2);
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

if (fileArg) {
  const target = fileArg.replace(/\\/g, '/').replace(/^apps\/mobile\//, '');
  const match = collectMobileStrings(MOBILE_ROOT).find((f) => f.rel === target);
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
  for (const { rel, literals } of collectMobileStrings(MOBILE_ROOT)) {
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
  const files = collectMobileStrings(MOBILE_ROOT).sort(
    (a, b) => b.literals.length - a.literals.length,
  );
  const total = files.reduce((sum, f) => sum + f.literals.length, 0);
  console.log(`未移行: ${total} 件 / ${files.length} ファイル\n`);
  for (const { rel, literals } of files) {
    console.log(`  ${String(literals.length).padStart(4)}  ${rel}`);
  }
}
