import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNAL_CODES, createSignal } from './lib/android-signals.mjs';

import { runCommand } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const options = parseArgs(process.argv.slice(2));
const adb = resolveAdb();
const device = options.device || resolveSingleDevice(adb);
const apkPath = resolve(rootDir, options.apk);
const args = ['-s', device, 'install', '-r'];

if (options.downgrade) {
  args.push('-d');
}

args.push(apkPath);

const result = runCommand(adb, args, { cwd: rootDir });
const summary = {
  ok: result.ok,
  device,
  apkPath,
  commandLine: result.commandLine,
  output: result.combinedOutput,
};

if (!result.ok) {
  summary.signal = createSignal(SIGNAL_CODES.APK_INSTALL_FAILED, result.combinedOutput || 'APK install failed');
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.ok ? 0 : 1);
}

if (!summary.ok) {
  console.error(summary.output || 'APK install failed.');
  process.exit(1);
}

console.log(`APK install OK on ${device}: ${apkPath}`);

function parseArgs(argv) {
  const parsed = {
    apk: 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk',
    device: '',
    downgrade: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apk' && argv[index + 1]) {
      parsed.apk = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--device' && argv[index + 1]) {
      parsed.device = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--downgrade') {
      parsed.downgrade = true;
      continue;
    }
    if (token === '--json') {
      parsed.json = true;
    }
  }

  return parsed;
}

function resolveAdb() {
  const candidates = [
    process.env.ADB_PATH,
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools', adbBinary()),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, 'platform-tools', adbBinary()),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', adbBinary()),
    adbBinary(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = runCommand(candidate, ['version'], { cwd: rootDir });
    if (result.ok) {
      return candidate;
    }
  }

  throw new Error('adb not found');
}

function resolveSingleDevice(adb) {
  const result = runCommand(adb, ['devices'], { cwd: rootDir });
  if (!result.ok) {
    throw new Error(result.combinedOutput || 'adb devices failed');
  }
  const devices = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List') && /\tdevice$/.test(line))
    .map((line) => line.split('\t')[0]);

  if (devices.length !== 1) {
    throw new Error('Specify --device when zero or multiple authorized devices are connected.');
  }

  return devices[0];
}

function adbBinary() {
  return process.platform === 'win32' ? 'adb.exe' : 'adb';
}