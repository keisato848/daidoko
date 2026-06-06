import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { platform } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const adbCandidates = [
  process.env.ADB_PATH,
  process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools', adbExecutable()),
  process.env.ANDROID_SDK_ROOT &&
    join(process.env.ANDROID_SDK_ROOT, 'platform-tools', adbExecutable()),
  process.env.LOCALAPPDATA &&
    join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', adbExecutable()),
  'adb',
].filter(Boolean);

const checks = [
  {
    id: 'node',
    label: 'Node.js',
    run: () => commandVersion('node', ['--version']),
  },
  {
    id: 'pnpm',
    label: 'pnpm',
    run: () => commandVersion(pnpmCommand(), ['--version']),
  },
  {
    id: 'git',
    label: 'Git',
    run: () => commandVersion('git', ['--version']),
  },
  {
    id: 'java',
    label: 'Java',
    run: () => commandVersion(javaCommand(), ['-version'], { useStderr: true }),
  },
  {
    id: 'adb',
    label: 'Android Debug Bridge',
    run: resolveAdb,
  },
  {
    id: 'gradle-wrapper',
    label: 'Android Gradle Wrapper',
    run: verifyGradleWrapper,
  },
  {
    id: 'play-signing-env',
    label: 'Play signing env',
    run: verifyPlaySigningEnv,
  },
];

const results = [];

for (const check of checks) {
  // Keep each check independent so the agent can make localized recovery decisions.
  results.push(await runCheck(check));
}

const summary = summarize(results);

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  printSummary(summary);
}

if (!summary.ok) {
  process.exitCode = 1;
}

function adbExecutable() {
  return platform() === 'win32' ? 'adb.exe' : 'adb';
}

function javaCommand() {
  if (process.env.JAVA_HOME) {
    const javaBinary = platform() === 'win32' ? 'java.exe' : 'java';
    return join(process.env.JAVA_HOME, 'bin', javaBinary);
  }
  return 'java';
}

function pnpmCommand() {
  return platform() === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

async function runCheck(check) {
  try {
    const detail = await check.run();
    return {
      id: check.id,
      label: check.label,
      ok: true,
      detail,
    };
  } catch (error) {
    return {
      id: check.id,
      label: check.label,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarize(entries) {
  return {
    ok: entries.every((entry) => entry.ok),
    rootDir,
    platform: platform(),
    entries,
  };
}

function printSummary(summary) {
  console.log(`Agent preflight: ${summary.ok ? 'OK' : 'FAILED'}`);
  console.log(`Workspace: ${summary.rootDir}`);
  console.log(`Platform: ${summary.platform}`);
  for (const entry of summary.entries) {
    console.log(`${entry.ok ? '[OK]' : '[NG]'} ${entry.label}: ${entry.detail}`);
  }
}

function commandVersion(command, args, options = {}) {
  const useShell = platform() === 'win32' && /\.cmd$/i.test(command);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    shell: useShell,
  });

  if (result.status !== 0 || result.error) {
    const failureDetail = result.error?.message ?? result.stderr.trim() ?? '';
    throw new Error(failureDetail || `${command} failed`);
  }

  const output = options.useStderr ? result.stderr.trim() : result.stdout.trim();
  if (!output) {
    throw new Error(`${command} returned no version output`);
  }

  return output.split(/\r?\n/)[0];
}

async function resolveAdb() {
  const attempts = [];

  for (const candidate of adbCandidates) {
    const result = spawnSync(candidate, ['version'], {
      cwd: rootDir,
      encoding: 'utf8',
      shell: false,
    });

    if (result.status === 0 && !result.error) {
      const output = result.stdout.trim().split(/\r?\n/)[0] || 'adb available';
      return `${candidate} (${output})`;
    }

    attempts.push(candidate);
  }

  throw new Error(`adb not found. Tried: ${attempts.join(', ')}`);
}

async function verifyGradleWrapper() {
  const wrapperPath = join(
    rootDir,
    'apps',
    'mobile',
    'android',
    platform() === 'win32' ? 'gradlew.bat' : 'gradlew',
  );
  await access(wrapperPath, fsConstants.F_OK);
  return wrapperPath;
}

async function verifyPlaySigningEnv() {
  const keys = [
    'DAIDOKO_UPLOAD_STORE_FILE',
    'DAIDOKO_UPLOAD_STORE_PASSWORD',
    'DAIDOKO_UPLOAD_KEY_ALIAS',
    'DAIDOKO_UPLOAD_KEY_PASSWORD',
  ];
  const present = keys.filter((key) => Boolean(process.env[key]));

  if (present.length === 0) {
    return 'not configured (acceptable for local APK validation)';
  }

  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`partially configured. Missing: ${missing.join(', ')}`);
  }

  return 'configured';
}