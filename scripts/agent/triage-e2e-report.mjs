import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonFile } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const options = parseArgs(process.argv.slice(2));
const files = options.files.length > 0 ? options.files : defaultFiles();
const summaries = [];

for (const filePath of files) {
  const absolutePath = join(rootDir, filePath);
  try {
    await access(absolutePath, fsConstants.F_OK);
    const parsed = await readJsonFile(absolutePath);
    summaries.push(summarizeReport(filePath, parsed));
  } catch (error) {
    summaries.push({
      file: filePath,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      failures: [],
    });
  }
}

if (options.json) {
  process.stdout.write(`${JSON.stringify({ summaries }, null, 2)}\n`);
  process.exit(summaries.every((summary) => summary.ok) ? 0 : 1);
}

for (const summary of summaries) {
  if (!summary.ok) {
    console.error(`[NG] ${summary.file}: ${summary.error}`);
    continue;
  }
  console.log(`[OK] ${summary.file}: ${summary.pass}/${summary.total} passed`);
  for (const failure of summary.failures) {
    console.log(`- ${failure.name}`);
    console.log(`  detail: ${failure.detail}`);
    console.log(`  hint: ${failure.hint}`);
  }
}

process.exit(summaries.every((summary) => summary.ok) ? 0 : 1);

function parseArgs(argv) {
  const parsed = { files: [], json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--file' && argv[index + 1]) {
      parsed.files.push(argv[index + 1]);
      index += 1;
    }
  }
  return parsed;
}

function defaultFiles() {
  return [
    'e2e/android-e2e-result.json',
    'e2e/android-ocr-e2e-result.json',
    'e2e/android-photo-recipe-e2e-result.json',
  ];
}

function summarizeReport(file, parsed) {
  const failures = (parsed.results ?? [])
    .filter((entry) => entry.status !== 'PASS')
    .map((entry) => ({
      name: entry.name,
      detail: entry.detail,
      hint: inferHint(entry),
    }));

  return {
    file,
    ok: true,
    pass: parsed.pass ?? 0,
    fail: parsed.fail ?? failures.length,
    total: parsed.total ?? parsed.results?.length ?? 0,
    failures,
  };
}

function inferHint(entry) {
  const detail = `${entry.name} ${entry.detail}`;
  if (/Tab not found/i.test(detail)) {
    return 'Check the tab label, route registration, and whether the tab is hidden by the current state.';
  }
  if (/No authorized Android device/i.test(detail)) {
    return 'Reconnect the device, unlock it, and rerun pnpm agent:preflight.';
  }
  if (/uiautomator|UI dump/i.test(detail)) {
    return 'Inspect ui-dumps and retry after collapsing system UI or restarting the stuck adb child process.';
  }
  if (/permission|denial|cancel/i.test(detail)) {
    return 'Recheck permission-dialog selectors and the reset path for camera or gallery permissions.';
  }
  return 'Inspect the owning flow and rerun the same suite after the smallest local fix.';
}