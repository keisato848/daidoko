/**
 * pre-commit: ステージ済み diff の追加行にシークレットが混入していないか検査する。
 * 対象: PEM 秘密鍵 / Google API キー / サービスアカウント JSON の断片。
 * パターン文字列は自己検出を避けるため分割して組み立てる。
 */
import { runCommand } from './lib/runtime.mjs';

const PATTERNS = [
  { name: 'PEM private key', re: new RegExp('-----BEGIN' + '[A-Z ]*' + 'PRIVATE KEY-----') },
  { name: 'Google API key', re: new RegExp('AIza' + '[0-9A-Za-z_-]{35}') },
  { name: 'Service account JSON', re: new RegExp('"private' + '_key"\\s*:') },
];

const diff = runCommand('git', ['diff', '--cached', '-U0']);
if (!diff.ok) {
  console.error('scan-staged-secrets: git diff failed');
  process.exit(1);
}

let currentFile = '(unknown)';
const hits = [];
for (const line of diff.stdout.split(/\r?\n/)) {
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice(6);
    continue;
  }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  for (const { name, re } of PATTERNS) {
    if (re.test(line)) hits.push({ file: currentFile, name });
  }
}

if (hits.length > 0) {
  console.error('[NG] シークレットらしき追加行を検出しました。コミットを中止します:');
  for (const hit of hits) console.error(`  - ${hit.file}: ${hit.name}`);
  console.error('該当行を除去するか、リポジトリ外（C:\\secure など）へ退避してください。');
  process.exit(1);
}

process.exit(0);
