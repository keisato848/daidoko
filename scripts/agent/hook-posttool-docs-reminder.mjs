/**
 * PostToolUse（Edit / Write / MultiEdit）: ハーネス・リリース・DB 等の
 * 「ドキュメント連動ファイル」を編集した直後に、対応する手順書 / Skill /
 * 設計書の更新を検討するようコンテキストを注入する。
 * 対応表は lib/docs-map.mjs（Stop ガードと共有）。
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdinJson } from './lib/runtime.mjs';
import { matchDocTargets, toRepoRelative } from './lib/docs-map.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const payload = await readStdinJson();

const input = payload?.tool_input ?? payload?.toolInput ?? {};
const candidates = [input.file_path, input.filePath, input.notebook_path].filter(
  (value) => typeof value === 'string' && value,
);

const files = candidates.map((file) => toRepoRelative(file, rootDir)).filter(Boolean);
const { targets } = matchDocTargets(files);

if (targets.length === 0) {
  process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
  process.exit(0);
}

const context = [
  `📝 ドキュメント連動ファイルを編集しました: ${files.join(', ')}`,
  `この変更が振る舞い・手順を変える場合、次の更新を同じブランチで行ってください: ${targets.join(' / ')}`,
  '（更新不要ならその理由をユーザーへの報告に一言含める）',
].join('\n');

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: context,
    },
  })}\n`,
);
