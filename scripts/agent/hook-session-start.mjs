import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWLEDGE_TARGETS } from './lib/knowledge-map.mjs';
import { readStdinJson, runCommand } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
// SessionStart の payload には source（startup / resume / clear / compact）が入る。
// 現状報告の案内は startup と clear のときだけ出す（resume / compact のたびに再注入しない）
const payload = await readStdinJson();
const source = typeof payload?.source === 'string' ? payload.source : 'startup';
const result = runCommand(process.execPath, ['scripts/agent/preflight.mjs', '--json'], {
  cwd: rootDir,
});

let systemMessage = 'Agent Suite session start. Preflight did not run.';

// preflight は要件を満たさないと exit 1 で返す（ADB の無いリモート環境では常に）。
// その場合も JSON は stdout に出ているので、成否に関わらずまず JSON として読む。
// 索引と案内は preflight の成否と無関係なので、どの分岐でも末尾に付ける。
const parsed = parsePreflight(result.stdout);
if (parsed) {
  const lines = ['Agent Suite session start', `Preflight: ${parsed.ok ? 'OK' : 'FAILED'}`];
  for (const entry of parsed.entries ?? []) {
    const marker = entry.ok ? '[OK]' : '[NG]';
    lines.push(`${marker} ${entry.label}: ${entry.detail}`);
  }
  systemMessage = lines.join('\n');
} else if (result.combinedOutput) {
  systemMessage = `Agent Suite session start\n${result.combinedOutput}`;
}
systemMessage = [systemMessage, ...knowledgeIndex(), ...sessionOpening()].join('\n');

function parsePreflight(stdout) {
  try {
    const summary = JSON.parse(stdout);
    return summary && typeof summary === 'object' ? summary : null;
  } catch {
    return null;
  }
}

/**
 * 「同じ穴を掘り直さない」ための索引（CLAUDE.md §5）。
 * **作業を始める前に該当箇所を読む**ためのもので、終わったら分かったことをここへ書き足す。
 * 実在するファイルだけ出す（消えた文書を指し続けないように）。
 */
function knowledgeIndex() {
  const lines = ['記録済みの落とし穴（着手前に該当箇所を読む / 終わりに書き足す）:'];
  for (const entry of KNOWLEDGE_TARGETS) {
    if (!existsSync(join(rootDir, entry.path))) continue;
    lines.push(`  - ${entry.kind} → ${entry.path} ${entry.section}`);
  }
  return lines.length > 1 ? lines : [];
}

/**
 * セッション開始の現状報告（docs/開発ハーネス.md §7-5）。
 * フックはエージェントを起動できないので、メインループへの案内だけを出す。
 * `project-manager` 定義が無ければ（別リポジトリ・削除後）何も出さない。
 */
function sessionOpening() {
  if (source === 'resume' || source === 'compact') return [];
  if (!existsSync(join(rootDir, '.claude/agents/project-manager.md'))) return [];
  return [
    '着手前: `project-manager` エージェントに「現状報告」を依頼する（ブランチ / PR / CI / ボード / 推奨の一手。15 行以内）。',
    '  ユーザーが具体的な指示を出しているときは、その作業を優先してよい（docs/開発ハーネス.md §7-5）。',
  ];
}

process.stdout.write(`${JSON.stringify({ continue: true, systemMessage }, null, 2)}\n`);
