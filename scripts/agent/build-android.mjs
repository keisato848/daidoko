import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNAL_CODES, createSignal } from './lib/android-signals.mjs';

import { runCommand } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const androidDir = join(rootDir, 'apps', 'mobile', 'android');
const options = parseArgs(process.argv.slice(2));
const wrapperPath = join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const gradleCache = process.env.GRADLE_CACHE || join(tmpdir(), 'daidoko-gradle-project-cache');

if (options.prebuild) {
  const prebuild = runCommand(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['--filter', 'mobile', 'exec', 'expo', 'prebuild', '--platform', 'android', '--no-install'],
    { cwd: rootDir },
  );
  if (!prebuild.ok) {
    console.error(prebuild.combinedOutput || 'Expo prebuild failed.');
    process.exit(1);
  }
}

const taskName = options.bundle ? ':app:bundleRelease' : ':app:assembleRelease';
const args = [
  taskName,
  '--project-cache-dir',
  gradleCache,
  '--no-daemon',
  '--console=plain',
  '-x',
  'lint',
  '-x',
  'test',
];

if (!options.bundle) {
  args.push('-x', 'lintVitalAnalyzeRelease', '-x', 'lintVitalReportRelease', '-x', 'lintVitalRelease');
  args.push(`-PreactNativeArchitectures=${options.arch}`);
}

const result = runCommand(wrapperPath, args, {
  cwd: androidDir,
  env: {
    // Release bundling needs NODE_ENV; Expo only sets it for `expo export`.
    NODE_ENV: 'production',
    // pnpm workspace: hoisted deps live in the repo-root node_modules, which
    // metro.config.js watches. Without this flag Expo treats the workspace root
    // as Metro's server root, but the RN Gradle plugin relativizes --entry-file
    // and bakes expo-router's app dir against apps/mobile — the mismatch makes
    // local release builds fail ("Unable to resolve ./index.js" / "No routes
    // found"). Pinning the server root to the project keeps them consistent.
    EXPO_NO_METRO_WORKSPACE_ROOT: '1',
  },
});

const summary = {
  ok: result.ok,
  mode: options.bundle ? 'bundle' : 'apk',
  arch: options.arch,
  artifact: options.bundle
    ? 'apps/mobile/android/app/build/outputs/bundle/release/app-release.aab'
    : 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk',
  commandLine: result.commandLine,
  output: result.combinedOutput,
};

if (!summary.ok) {
  const output = summary.output || '';
  if (output.includes('.cxx') && output.includes('lock')) {
    summary.signal = createSignal(SIGNAL_CODES.GRADLE_CXX_LOCK, 'Gradle CXX lock detected in build output.');
  }
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.ok ? 0 : 1);
}

if (!summary.ok) {
  console.error(summary.output || 'Android build failed.');
  process.exit(1);
}

console.log(`Android build OK: ${summary.artifact}`);

function parseArgs(argv) {
  const parsed = {
    arch: 'arm64-v8a',
    bundle: false,
    json: false,
    prebuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--arch' && argv[index + 1]) {
      parsed.arch = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--bundle') {
      parsed.bundle = true;
      continue;
    }
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--prebuild') {
      parsed.prebuild = true;
    }
  }

  return parsed;
}