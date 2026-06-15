import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCommand } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const result = runCommand(process.execPath, ['scripts/agent/preflight.mjs', '--json'], {
  cwd: rootDir,
});

let systemMessage = 'Agent Suite session start. Preflight did not run.';

if (result.ok) {
  try {
    const summary = JSON.parse(result.stdout);
    const lines = ['Agent Suite session start', `Preflight: ${summary.ok ? 'OK' : 'FAILED'}`];
    for (const entry of summary.entries ?? []) {
      const marker = entry.ok ? '[OK]' : '[NG]';
      lines.push(`${marker} ${entry.label}: ${entry.detail}`);
    }
    systemMessage = lines.join('\n');
  } catch {
    systemMessage = `Agent Suite session start\n${result.stdout.trim()}`.trim();
  }
} else if (result.combinedOutput) {
  systemMessage = `Agent Suite session start\n${result.combinedOutput}`;
}

process.stdout.write(
  `${JSON.stringify({ continue: true, systemMessage }, null, 2)}\n`,
);