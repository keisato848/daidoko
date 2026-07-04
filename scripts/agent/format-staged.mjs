/**
 * pre-commit: ステージ済みファイルを Prettier で自動整形して再ステージする。
 * 整形差分・CRLF 起因のコミット失敗ループ（1.3.0 リリース中に頻発）を根絶する。
 */
import { runCommand } from './lib/runtime.mjs';

const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|md)$/i;

const diff = runCommand('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
if (!diff.ok) {
  console.error('format-staged: git diff failed');
  process.exit(1);
}

const files = diff.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && EXTENSIONS.test(line));

if (files.length === 0) {
  process.exit(0);
}

const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const prettier = runCommand(pnpmCmd, ['exec', 'prettier', '--write', '--ignore-unknown', ...files]);
if (!prettier.ok) {
  console.error('format-staged: prettier failed');
  console.error(prettier.combinedOutput?.slice(0, 1000) ?? '');
  process.exit(1);
}

const add = runCommand('git', ['add', '--', ...files]);
if (!add.ok) {
  console.error('format-staged: git add failed');
  process.exit(1);
}

console.log(`[OK] prettier auto-format: ${files.length} file(s)`);
