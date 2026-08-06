/**
 * 実機検証の記録を残す（リリースの前提条件）。
 *
 * なぜ必要か: 1.4.5 の準備で、エミュレーターでは1件も出なかった不具合が**実機で4件**出た。
 * 出力枠の枯渇（材料18のレシピ）・差分が注記で埋まる・同名材料の取り違え・明るい写真で
 * ヘッダーのボタンが消える。いずれも実データの規模・構造・明るさでしか現れない。
 * 「実機で確認した」を人の記憶に委ねず、**機械が確かめられる記録**にする。
 *
 * このスクリプトは端末に実際に接続して確かめる:
 *   - 端末がつながっていること（エミュレーターは既定で不可）
 *   - **端末に入っているアプリの versionCode が app.json と一致すること**
 *     （古いビルドを触って「確認した」と記録するのを防ぐ）
 *   - スクリーンショットを証跡として保存する
 *
 * 記録は docs/verification/<version>-<versionCode>.json。
 * `eas submit` のガード（hook-pretool-guard.mjs）がこれを見る。
 *
 * 使い方:
 *   node scripts/agent/record-device-verification.mjs --checked "R2 の一気通貫" --checked "起動即カメラ"
 *   node scripts/agent/record-device-verification.mjs --allow-emulator   # 例外時のみ
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDevices, resolveAdbPath } from './lib/adb.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RECORD_DIR = join(REPO_ROOT, 'docs', 'verification');

const options = parseArgs(process.argv.slice(2));

const app = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/mobile/app.json'), 'utf8'));
const version = app?.expo?.version;
const versionCode = app?.expo?.android?.versionCode;
const packageName = app?.expo?.android?.package;
if (!version || !versionCode || !packageName) {
  fail('apps/mobile/app.json から version / versionCode / package を読めません。');
}

let adbPath;
try {
  adbPath = resolveAdbPath();
} catch {
  fail('adb が見つかりません。Android SDK の platform-tools を PATH に通してください。');
}

const devices = getDevices(adbPath).filter((device) => device.status === 'device');
if (devices.length === 0) {
  fail('端末がつながっていません。USB で接続して `adb devices` に出る状態にしてください。');
}
if (devices.length > 1 && !options.serial) {
  fail(
    `端末が複数つながっています（${devices.map((d) => d.serial).join(', ')}）。` +
      '--serial <serial> でどれを検証したか指定してください。',
  );
}
const serial = options.serial ?? devices[0].serial;

const model = getProp(serial, 'ro.product.model');
const abi = getProp(serial, 'ro.product.cpu.abi');
// エミュレーターの判定は複数の手掛かりを見る（1つだと機種によってすり抜ける）
const isEmulator =
  /^emulator-/.test(serial) ||
  getProp(serial, 'ro.kernel.qemu') === '1' ||
  /generic|sdk_gphone|emulator/i.test(getProp(serial, 'ro.product.device'));

if (isEmulator && !options.allowEmulator) {
  fail(
    `${serial} はエミュレーターです。**リリース前の検証は実機で行ってください。**\n` +
      'エミュレーターでは、実データの規模（材料18のレシピ）・同名材料・明るい写真といった\n' +
      '条件が揃わず、1.4.5 の準備で実機のみで見つかった不具合が4件ありました。\n' +
      'どうしてもエミュレーターで記録する場合は --allow-emulator を付けてください（submit ガードは通りません）。',
  );
}

// 端末に入っているのが「いま出そうとしているビルド」かを確かめる。
// 古いビルドを触って確認済みにするのが、いちばん起きやすい取り違え。
const installed = getInstalledVersionCode(serial, packageName);
if (installed === null) {
  fail(
    `${packageName} が ${serial} に入っていません。検証対象のビルドを入れてから実行してください。`,
  );
}
if (String(installed) !== String(versionCode)) {
  fail(
    `端末に入っているのは versionCode ${installed} ですが、app.json は ${versionCode} です。\n` +
      '検証したビルドとリリースするビルドが違います。入れ直してから記録してください。',
  );
}

if (options.checked.length === 0) {
  fail(
    '何を確認したかを --checked "…" で1つ以上渡してください（例: --checked "R2 の一気通貫" --checked "起動即カメラ"）。',
  );
}

mkdirSync(RECORD_DIR, { recursive: true });
const stamp = new Date().toISOString();
const shotName = `${version}-${versionCode}-${stamp.replace(/[:.]/g, '-')}.png`;
const shotPath = join(RECORD_DIR, 'screenshots', shotName);
mkdirSync(join(RECORD_DIR, 'screenshots'), { recursive: true });
captureScreenshot(serial, shotPath);

const record = {
  version,
  versionCode,
  verifiedAt: stamp,
  device: { serial, model, abi, isEmulator },
  installedVersionCode: installed,
  checked: options.checked,
  screenshot: `screenshots/${shotName}`,
  // このコミットで検証した、という手掛かり。以降にアプリを変更したら再検証が要る
  headCommit: gitHead(),
};

const recordPath = join(RECORD_DIR, `${version}-${versionCode}.json`);
writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

console.log(`実機検証を記録しました: docs/verification/${version}-${versionCode}.json`);
console.log(`  端末: ${model} (${serial}, ${abi})${isEmulator ? ' ※エミュレーター' : ''}`);
console.log(`  確認: ${options.checked.join(' / ')}`);
console.log(`  証跡: docs/verification/screenshots/${shotName}`);

function getProp(deviceSerial, key) {
  const result = spawnSync(adbPath, ['-s', deviceSerial, 'shell', 'getprop', key], {
    encoding: 'utf8',
    shell: false,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function getInstalledVersionCode(deviceSerial, pkg) {
  const result = spawnSync(adbPath, ['-s', deviceSerial, 'shell', 'dumpsys', 'package', pkg], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return null;
  const match = /versionCode=(\d+)/.exec(result.stdout);
  return match ? Number(match[1]) : null;
}

function captureScreenshot(deviceSerial, outPath) {
  const result = spawnSync(adbPath, ['-s', deviceSerial, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  if (result.status !== 0 || !result.stdout?.length) {
    fail('スクリーンショットを取得できませんでした（画面がロックされていませんか）。');
  }
  writeFileSync(outPath, result.stdout);
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function fail(message) {
  console.error(`[検証記録できません] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = { checked: [], allowEmulator: false, serial: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--checked' && argv[index + 1]) {
      parsed.checked.push(argv[index + 1]);
      index += 1;
    } else if (token === '--serial' && argv[index + 1]) {
      parsed.serial = argv[index + 1];
      index += 1;
    } else if (token === '--allow-emulator') {
      parsed.allowEmulator = true;
    }
  }
  return parsed;
}
