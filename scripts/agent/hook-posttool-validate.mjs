import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdinJson, runCommand, unique } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const payload = await readStdinJson();
const toolName = extractToolName(payload).toLowerCase();

if (!isEditLikeTool(toolName)) {
  process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
  process.exit(0);
}

const files = unique(extractFiles(payload));
if (files.length === 0) {
  process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
  process.exit(0);
}

const result = runCommand(
  process.execPath,
  ['scripts/agent/validate-changed-slice.mjs', '--files', ...files, '--json'],
  { cwd: rootDir },
);

let systemMessage = `Changed-slice validation ran for ${files.join(', ')}.`;
if (result.ok) {
  try {
    const summary = JSON.parse(result.stdout);
    const lines = [
      `Changed-slice validation ${summary.ok ? 'OK' : 'FAILED'}`,
      `Files: ${summary.files.join(', ')}`,
    ];
    for (const task of summary.tasks) {
      const marker = task.ok ? '[OK]' : '[NG]';
      lines.push(`${marker} ${task.label}`);
      if (task.output) {
        lines.push(task.output);
      }
    }
    for (const recommendation of summary.recommendations ?? []) {
      lines.push(`[NEXT] ${recommendation}`);
    }
    systemMessage = lines.join('\n');
  } catch {
    systemMessage = result.stdout.trim() || systemMessage;
  }
} else if (result.combinedOutput) {
  systemMessage = `Changed-slice validation failed to execute\n${result.combinedOutput}`;
}

process.stdout.write(`${JSON.stringify({ continue: true, systemMessage }, null, 2)}\n`);

function extractToolName(value) {
  return value?.toolName ?? value?.tool?.name ?? value?.name ?? '';
}

function isEditLikeTool(toolName) {
  return /apply_patch|create_file|edit|write|rename/i.test(toolName);
}

function extractFiles(value) {
  const explicit = [
    value?.toolInput?.filePath,
    value?.toolInput?.path,
    value?.input?.filePath,
    value?.input?.path,
  ].filter((entry) => typeof entry === 'string' && entry.trim());

  const explicitMany = [
    ...(Array.isArray(value?.toolInput?.filePaths) ? value.toolInput.filePaths : []),
    ...(Array.isArray(value?.input?.filePaths) ? value.input.filePaths : []),
  ].filter((entry) => typeof entry === 'string' && entry.trim());

  const patchText =
    value?.toolInput?.input ?? value?.input?.input ?? value?.arguments?.input ?? value?.command ?? '';
  const fromPatch =
    typeof patchText === 'string'
      ? [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) =>
          match[1].trim(),
        )
      : [];

  return [...explicit, ...explicitMany, ...fromPatch].map((filePath) => filePath.replaceAll('\\', '/'));
}