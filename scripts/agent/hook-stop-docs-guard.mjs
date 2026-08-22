/**
 * Stop フック: ターン終了時に 2 つを一度だけ確かめ、必要なら停止をブロックして
 * 自律的に直させる。どちらもループ防止のため `stop_hook_active` で 1 回きり。
 *
 * 1. **ドキュメント連動**: 連動ファイルが変わったのに対応ドキュメント/Skill が未更新
 *    （対応表: lib/docs-map.mjs — PostToolUse リマインダーと共有）
 * 2. **分かったことの記録**: 調べ物・実機検証をしたのに、記録（docs/・Skill・CLAUDE.md）が
 *    1 行も増えていない（CLAUDE.md §5「分かったことは必ずリポジトリに残す」）。
 *    書くことが無ければ理由を述べて終われるので、ゲートではなく**立ち止まり**
 *
 * 対象: 作業ツリーの変更 + （feature ブランチなら）develop からの差分
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdinJson, runCommand, unique } from './lib/runtime.mjs';
import { DOC_TARGET_HINT, matchDocTargets } from './lib/docs-map.mjs';
import {
  INVESTIGATION_SIGNALS,
  KNOWLEDGE_PATH_HINT,
  KNOWLEDGE_TARGETS,
} from './lib/knowledge-map.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const payload = await readStdinJson();

// 直前の Stop ブロックから続行してきた場合は再ブロックしない（無限ループ防止）
if (payload?.stop_hook_active) {
  allow();
}

const changed = collectChangedFiles();

// 1. ドキュメント連動（従来の督促）
if (changed.length > 0) {
  const { targets, hits } = matchDocTargets(changed);
  const docTouched = changed.some((file) => DOC_TARGET_HINT.test(file));
  if (targets.length > 0 && !docTouched) {
    const fileList = unique(hits.map((hit) => hit.file))
      .slice(0, 5)
      .join(', ');
    block(
      `ドキュメント連動ファイル（${fileList}）が変更されていますが、対応するドキュメント/Skill が未更新です。` +
        `次を更新してください: ${targets.join(' / ')}。` +
        '振る舞い・手順が変わらない変更で更新不要な場合は、その理由をユーザーへの報告に含めたうえで終了してください。',
    );
  }
}

// 2. 分かったことの記録（調べ物・実機検証をしたターン）
//
// 判定は**このターンで書いたか**に寄せる（作業ツリー＋直近コミット）。ブランチ全体で
// 見ると、一度でも docs を触った長寿命ブランチでは二度と鳴らなくなる。
if (!recordedRecently() && didInvestigate(payload?.transcript_path)) {
  const where = KNOWLEDGE_TARGETS.map((entry) => `${entry.path} ${entry.section}`).join(' / ');
  block(
    '実機・エミュレーターの操作や調査コマンドを実行しましたが、記録（docs/・Skill・CLAUDE.md）が 1 行も増えていません。' +
      `次に触る人が同じ穴を掘り直さないよう、分かったことを症状→原因→対処の順で書いてください: ${where}。` +
      '記録すべき発見が無かった場合は、その旨をユーザーへの報告に明記したうえで終了してください（CLAUDE.md §5）。',
  );
}

allow();

/**
 * 記録（docs/・Skill・CLAUDE.md）が直近で増えたか。
 * 作業ツリーの変更と、直近コミットの両方を見る（書いてすぐコミットした場合を拾う）。
 */
function recordedRecently() {
  const files = [...worktreeFiles(), ...lastCommitFiles()];
  return files.some((file) => KNOWLEDGE_PATH_HINT.test(file));
}

function worktreeFiles() {
  const status = runCommand('git', ['status', '--porcelain'], { cwd: rootDir });
  if (!status.ok) return [];
  return status.stdout
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/'))
    .filter(Boolean);
}

function lastCommitFiles() {
  const show = runCommand('git', ['show', '--name-only', '--pretty=format:', 'HEAD'], {
    cwd: rootDir,
  });
  if (!show.ok) return [];
  return show.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);
}

/**
 * このターンで調べ物・検証をしたか。**判定材料が無ければ「していない」に倒す**
 * （フェイルオープン。督促のために作業を止めない）。
 */
function didInvestigate(transcriptPath) {
  if (!transcriptPath) return false;
  try {
    const size = statSync(transcriptPath).size;
    // 直近だけ見る（長い会話で全部読むと重い）
    const maxBytes = 400_000;
    let text = readFileSync(transcriptPath, 'utf8');
    if (size > maxBytes) text = text.slice(-maxBytes);
    return INVESTIGATION_SIGNALS.some((pattern) => pattern.test(text));
  } catch {
    return false;
  }
}

function block(reason) {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`);
  process.exit(0);
}

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
