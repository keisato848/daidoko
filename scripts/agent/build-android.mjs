import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDevices, resolveAdbPath } from './lib/adb.mjs';
import { SIGNAL_CODES, createSignal } from './lib/android-signals.mjs';

import { runCommand } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const androidDir = join(rootDir, 'apps', 'mobile', 'android');
const options = parseArgs(process.argv.slice(2));

// **Expo パッケージの版が SDK とずれていないか。** ずれたまま組むと、ビルドも
// インストールも成功するのに**起動直後に NoSuchMethodError で落ちる**（JS 側の
// テストは native を読まないので全部通ってしまう）。
//
// 実例: expo-localization を `^57.0.1`（遥かに新しい SDK 用）で入れてしまい、
// expo-modules-core 3.0.30 に無い getDirectConverter を呼んで即クラッシュした。
// `expo install --check` はこのリポジトリの tooling では動かないので自前で見る。
assertExpoSdkVersions();

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
// 端末の ABI と食い違う arch でビルドすると、インストールは成功するのに起動直後に
// SoLoaderDSONotFoundError（libreactnative.so が無い）で落ちる。原因が JS の変更に
// 見えてしまうので、接続中の端末を見て先に警告する。
// 既定は実機（arm64-v8a）だが、エミュレーターは x86_64 のことが多い。
if (!options.bundle && !options.archExplicit) {
  warnOnDeviceAbiMismatch(options.arch);
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
 * `apps/mobile/package.json` の Expo パッケージが、SDK の想定版と揃っているか。
 *
 * 揃っていないと、**ビルドは通るのに起動直後に落ちる**。しかも JS のテストは
 * native を読まないので全部緑のまま。CI では絶対に捕まらないため、ここで止める。
 */
function assertExpoSdkVersions() {
  let bundled;
  try {
    bundled = JSON.parse(
      readFileSync(join(rootDir, 'node_modules', 'expo', 'bundledNativeModules.json'), 'utf8'),
    );
  } catch {
    console.warn('[WARN] expo/bundledNativeModules.json を読めないため、版の検査を飛ばします。');
    return;
  }
  const pkg = JSON.parse(readFileSync(join(rootDir, 'apps', 'mobile', 'package.json'), 'utf8'));
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const mismatched = [];

  // メジャーだけ見る。SDK の想定は `~17.0.9` のような範囲で、パッチ差は
  // 問題にならないが**メジャー違いは native の API が違う**
  const major = (version) =>
    String(version)
      .replace(/^[~^>=<\s]+/, '')
      .split('.')[0];

  for (const [name, want] of Object.entries(bundled)) {
    if (!(name in declared)) continue;

    // **宣言と実際の両方を見る。** 実際（node_modules）だけだと、宣言がずれたまま
    // ローカルに古い版が残っている状態を見逃し、EAS の新規インストールで初めて壊れる。
    // 宣言だけだと、手で node_modules を触った状態を見逃す。
    if (major(declared[name]) !== major(want)) {
      mismatched.push(`${name}: 宣言 ${declared[name]} / SDK 想定 ${want}`);
      continue;
    }
    let installed;
    try {
      installed = JSON.parse(
        readFileSync(join(rootDir, 'node_modules', name, 'package.json'), 'utf8'),
      ).version;
    } catch {
      continue; // 未インストール（省略可能な peer など）は対象外
    }
    if (major(installed) !== major(want)) {
      mismatched.push(`${name}: 実際 ${installed} / SDK 想定 ${want}`);
    }
  }

  if (mismatched.length > 0) {
    console.error(
      `[FAIL] Expo パッケージの版が SDK とずれています（${mismatched.length} 件）:\n` +
        mismatched.map((line) => `       - ${line}`).join('\n') +
        '\n       このまま組むと、インストールは成功するのに起動直後に落ちます。\n' +
        '       apps/mobile/package.json を SDK 想定の版に直し、リポジトリルートで pnpm install してください。',
    );
    process.exit(1);
  }
}

/**
 * app.json / plugins/ / package.json の最終更新が android/ の生成物より新しければ、その一覧を返す。
 * android/ が未生成（初回）の場合は prebuild が必須なので全ソースを返す。
 */
function detectPrebuildStaleness() {
  // package.json も見る。**ネイティブモジュールの追加・削除は app.json に出ない**ので、
  // ここを見ないと prebuild が要ることに気づけない
  const sources = [
    join(rootDir, 'apps', 'mobile', 'app.json'),
    join(rootDir, 'apps', 'mobile', 'package.json'),
  ];
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

/**
 * 接続中の端末の主 ABI と targetArch が食い違うときに警告する。
 * adb が無い / 端末が繋がっていない場合は黙って何もしない（ビルドは止めない）。
 *
 * 見るのは ro.product.cpu.abilist ではなく **ro.product.cpu.abi**（主 ABI）。
 * x86_64 エミュレーターは abilist に arm64-v8a を含むので、abilist で判定すると
 * この不一致をすり抜ける。SoLoader が探すのは主 ABI 側なので落ちる。
 */
function warnOnDeviceAbiMismatch(targetArch) {
  let devices;
  let adbPath;
  try {
    adbPath = resolveAdbPath();
    devices = getDevices(adbPath).filter((device) => device.status === 'device');
  } catch {
    return; // adb 不在ならこのチェックは対象外
  }
  if (devices.length === 0) return;

  const mismatched = [];
  for (const device of devices) {
    const result = spawnSync(
      adbPath,
      ['-s', device.serial, 'shell', 'getprop', 'ro.product.cpu.abi'],
      { encoding: 'utf8', shell: false },
    );
    if (result.status !== 0 || result.error) continue;
    const primaryAbi = result.stdout.trim();
    if (primaryAbi && primaryAbi !== targetArch) {
      mismatched.push({ serial: device.serial, primaryAbi });
    }
  }
  // 対応端末が1台でも繋がっていれば、そちらで試すつもりとみなして黙る
  if (mismatched.length === 0 || mismatched.length < devices.length) return;

  console.warn(
    `[WARN] 接続中の端末の ABI は ${targetArch} ではありません: ` +
      mismatched.map((m) => `${m.serial} (${m.primaryAbi})`).join(', ') +
      '\n       このまま入れると、インストールは成功するのに起動時に' +
      ' libreactnative.so が見つからず落ちます。' +
      `\n       この端末で試すなら --arch ${mismatched[0].primaryAbi} を付けてください。`,
  );
}

function parseArgs(argv) {
  const parsed = {
    arch: 'arm64-v8a',
    archExplicit: false,
    bundle: false,
    json: false,
    prebuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--arch' && argv[index + 1]) {
      parsed.arch = argv[index + 1];
      parsed.archExplicit = true;
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
