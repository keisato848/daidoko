/**
 * Stop フック: ターン終了時に「ドキュメント連動ファイルが変更されているのに
 * 対応ドキュメント / Skill が未更新」なら一度だけ停止をブロックし、
 * 更新（または不要理由の明示）を自律実行させる。
 *
 * - ループ防止: stop_hook_active が立っていたら必ず allow
 * - 対象: 作業ツリーの変更 + （feature ブランチなら）develop からの差分
 * - 対応表: lib/docs-map.mjs（PostToolUse リマインダーと共有）
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdinJson, runCommand, unique } from './lib/runtime.mjs';
import { DOC_TARGET_HINT, matchDocTargets } from './lib/docs-map.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const payload = await readStdinJson();

// 直前の Stop ブロックから続行してきた場合は再ブロックしない（無限ループ防止）
if (payload?.stop_hook_active) {
  allow();
}

const changed = collectChangedFiles();
if (changed.length === 0) {
  allow();
}

const { targets, hits } = matchDocTargets(changed);
if (targets.length === 0) {
  allow();
}

// ドキュメント側も同時に変更されていれば督促不要
const docTouched = changed.some((file) => DOC_TARGET_HINT.test(file));
if (docTouched) {
  allow();
}

const fileList = unique(hits.map((hit) => hit.file))
  .slice(0, 5)
  .join(', ');
process.stdout.write(
  `${JSON.stringify({
    decision: 'block',
    reason:
      `ドキュメント連動ファイル（${fileList}）が変更されていますが、対応するドキュメント/Skill が未更新です。` +
      `次を更新してください: ${targets.join(' / ')}。` +
      '振る舞い・手順が変わらない変更で更新不要な場合は、その理由をユーザーへの報告に含めたうえで終了してください。',
  })}\n`,
);
process.exit(0);

function collectChangedFiles() {
  const files = [];

  // 作業ツリー（staged + unstaged + untracked）
  const status = runCommand('git', ['status', '--porcelain'], { cwd: rootDir });
  if (status.ok) {
    for (const line of status.stdout.split(/\r?\n/)) {
      const file = line.slice(3).trim().replace(/^"|"$/g, '');
      if (file) files.push(file.replace(/\\/g, '/'));
    }
  }

  // feature ブランチなら develop からの差分も見る（コミット済みの未文書化を拾う）
  const branch = runCommand('git', ['branch', '--show-current'], { cwd: rootDir });
  const name = branch.ok ? branch.stdout.trim() : '';
  if (name && name !== 'develop' && name !== 'main') {
    const diff = runCommand('git', ['diff', '--name-only', 'develop...HEAD'], { cwd: rootDir });
    if (diff.ok) {
      for (const line of diff.stdout.split(/\r?\n/)) {
        const file = line.trim();
        if (file) files.push(file.replace(/\\/g, '/'));
      }
    }
  }

  return unique(files);
}

function allow() {
  process.stdout.write(`${JSON.stringify({})}\n`);
  process.exit(0);
}
