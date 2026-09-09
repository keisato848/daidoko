import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { platform } from 'node:os';

export const isWindows = platform() === 'win32';

export function pnpmBinary() {
  return isWindows ? 'pnpm.cmd' : 'pnpm';
}

export function formatCommand(command, args = []) {
  return [command, ...args].map(quotePart).join(' ');
}

/**
 * `shell: true` の spawnSync は**引数をクォートしない**（Node の仕様）。Windows では
 * cmd.exe がそのまま解釈するので、`apps/mobile/app/(tabs)/menu.tsx` のような
 * **括弧を含むパス**が「`(tabs)` was unexpected at this time.」で死ぬ。
 * Expo Router のルート群は丸ごと `app/(tabs)/` の下にあるため、放っておくと
 * **モバイル画面を触るコミットが Windows で軒並み pre-commit を通れない**（2026-09-08 に実発）。
 * shell 経由のときだけ、cmd のメタ文字を含む引数を二重引用符で包む。
 */
function quoteForShell(value) {
  const text = String(value);
  if (text === '' || /["]/.test(text)) return text; // 既に引用符を含むものは触らない
  return /[\s()&|<>^,;]/.test(text) ? `"${text}"` : text;
}

export function runCommand(command, args = [], options = {}) {
  const shell = options.shell ?? (isWindows && /\.(cmd|bat)$/i.test(command));
  const spawnArgs = shell && isWindows ? args.map(quoteForShell) : args;
  const result = spawnSync(command, spawnArgs, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    shell,
    // 既定 1MB だとリリースマージの `git diff --cached` で溢れて
    // pre-commit（scan-staged-secrets 等）が「git diff failed」で死ぬ（2026-09-05 に実発）
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  return {
    ok: result.status === 0 && !result.error,
    status: result.status ?? 1,
    error: result.error?.message ?? null,
    stdout,
    stderr,
    combinedOutput: [stdout, stderr].filter(Boolean).join('\n').trim(),
    commandLine: formatCommand(command, args),
  };
}

export function tail(text, lines = 20) {
  return String(text).split(/\r?\n/).filter(Boolean).slice(-lines).join('\n');
}

export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function readStdinJson() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
  }
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { rawText: raw };
  }
}

export function toPosixPath(filePath) {
  return String(filePath).replaceAll('\\', '/');
}

export function unique(values) {
  return [...new Set(values)];
}

function quotePart(part) {
  const value = String(part);
  return /\s/.test(value) ? JSON.stringify(value) : value;
}
