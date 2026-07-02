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

export function runCommand(command, args = [], options = {}) {
  const shell = options.shell ?? (isWindows && /\.(cmd|bat)$/i.test(command));
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    shell,
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
  return String(text)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-lines)
    .join('\n');
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