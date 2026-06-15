import { chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isWindows, runCommand } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const hooksPath = '.githooks';
const result = runCommand('git', ['config', 'core.hooksPath', hooksPath], { cwd: rootDir });

if (!result.ok) {
  console.error(result.combinedOutput || 'Failed to configure git hooks path.');
  process.exit(1);
}

if (!isWindows) {
  await chmod(join(rootDir, '.githooks', 'pre-commit'), 0o755);
  await chmod(join(rootDir, '.githooks', 'pre-push'), 0o755);
}

console.log(`Git hooks installed via core.hooksPath=${hooksPath}`);