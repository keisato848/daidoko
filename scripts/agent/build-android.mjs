import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNAL_CODES, createSignal } from './lib/android-signals.mjs';

import { runCommand } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const androidDir = join(rootDir, 'apps', 'mobile', 'android');
const options = parseArgs(process.argv.slice(2));

// config plugin / app.json の変更は prebuild しないと android/ に反映されない
// （注入がサイレント no-op になり EAS ビルド全滅の実績あり）。陳腐化を検知して警告する。
if (!options.prebuild) {
  const staleSources = detectPrebuildStaleness();
  if (staleSources.length > 0) {
    console.warn(
      `[WARN] android/ より新しいネイティブ設定ソースがあります: ${staleSources.join(', ')}\n` +
        '       app.json / config plugin の変更を反映するには --prebuild を付けてください（docs/リリース手順.md）。',
    );
  }
}
const wrapperPath = join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const gradleCache = process.env.GRADLE_CACHE || join(tmpdir(), 'daidoko-gradle-project-cache');

// EXPO_PUBLIC_* は JS バンドルに焼き込まれるが、Gradle のバンドルタスクは JS ソースが
// 不変だとキャッシュを再利用し、フラグ変更がサイレントに反映されない（Pixel 広告テストで
// 被弾: ADMOB_ENABLED=true が前回のフラグなしバンドルに負けた）。フィンガープリントを
// 記録し、変化していたらバンドル生成物を破棄して再生成させる。
invalidateJsBundleIfPublicEnvChanged();

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
  args.push(
    '-x',
    'lintVitalAnalyzeRelease',
    '-x',
    'lintVitalReportRelease',
    '-x',
    'lintVitalRelease',
  );
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
    summary.signal = createSignal(
      SIGNAL_CODES.GRADLE_CXX_LOCK,
      'Gradle CXX lock detected in build output.',
    );
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

/**
 * app.json / plugins/ の最終更新が android/ の生成物より新しければ、その一覧を返す。
 * android/ が未生成（初回）の場合は prebuild が必須なので全ソースを返す。
 */
function detectPrebuildStaleness() {
  const sources = [join(rootDir, 'apps', 'mobile', 'app.json')];
  const pluginsDir = join(rootDir, 'apps', 'mobile', 'plugins');
  try {
    for (const name of readdirSync(pluginsDir)) sources.push(join(pluginsDir, name));
  } catch {
    // plugins ディレクトリが無ければ app.json のみ検査
  }
  let androidMtime = 0;
  try {
    androidMtime = statSync(join(androidDir, 'app', 'build.gradle')).mtimeMs;
  } catch {
    return sources.map((p) => p.slice(rootDir.length + 1));
  }
  const stale = [];
  for (const src of sources) {
    try {
      if (statSync(src).mtimeMs > androidMtime) stale.push(src.slice(rootDir.length + 1));
    } catch {
      // 消えたソースは無視
    }
  }
  return stale;
}

/** EXPO_PUBLIC_* の組が前回ビルドと異なれば JS バンドルのキャッシュ生成物を破棄する */
function invalidateJsBundleIfPublicEnvChanged() {
  const fingerprint = JSON.stringify(
    Object.entries(process.env)
      .filter(([key]) => key.startsWith('EXPO_PUBLIC_'))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const buildDir = join(androidDir, 'app', 'build');
  const fingerprintPath = join(buildDir, 'expo-public-env.fingerprint');

  let previous = null;
  try {
    previous = readFileSync(fingerprintPath, 'utf8');
  } catch {
    // 初回ビルド or クリーン後
  }
  if (previous === fingerprint) return;

  if (previous != null) {
    console.warn(
      '[INFO] EXPO_PUBLIC_* が前回ビルドから変化しました — JS バンドルキャッシュを破棄して再生成します。',
    );
  }
  for (const dir of [
    join(buildDir, 'generated', 'assets', 'createBundleReleaseJsAndAssets'),
    join(buildDir, 'generated', 'res', 'createBundleReleaseJsAndAssets'),
    join(buildDir, 'intermediates', 'assets'),
  ]) {
    rmSync(dir, { recursive: true, force: true });
  }
  try {
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(fingerprintPath, fingerprint);
  } catch {
    // build ディレクトリを作れなくても致命ではない（次回また破棄されるだけ）
  }
}

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
