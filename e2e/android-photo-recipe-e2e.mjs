#!/usr/bin/env node
/**
 * Android food-photo recipe release E2E.
 * Verifies the production photo entry and permission-denied paths without test-only fixture buttons.
 */
import { spawnSync } from 'child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PKG = 'com.daidoko.app';
const ACT = `${PKG}/.MainActivity`;
const SCREENSHOT_DIR = resolve('e2e/screenshots/photo-recipe-android');
const DUMP_DIR = resolve('e2e/ui-dumps/photo-recipe-android');
const ADB_TIMEOUT_MS = Number(process.env.ADB_TIMEOUT_MS || 45000);
const UI_DUMP_TIMEOUT_MS = Number(process.env.UI_DUMP_TIMEOUT_MS || 20000);
let DEVICE_SERIAL = process.env.TARGET_DEVICE || null;

const ADB =
  process.env.ADB_PATH ||
  (() => {
    if (process.platform !== 'win32') return 'adb';
    const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (androidHome) return `${androidHome}\\platform-tools\\adb.exe`;
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) return `${localAppData}\\Android\\Sdk\\platform-tools\\adb.exe`;
    return 'adb';
  })();

mkdirSync(SCREENSHOT_DIR, { recursive: true });
mkdirSync(DUMP_DIR, { recursive: true });

const results = [];
const permissionSnapshot = new Map();

function adbResult(args, timeout = ADB_TIMEOUT_MS) {
  const fullArgs = DEVICE_SERIAL && args[0] !== 'devices' ? ['-s', DEVICE_SERIAL, ...args] : args;
  return spawnSync(ADB, fullArgs, { encoding: 'utf8', shell: false, timeout });
}

function adbDetail(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const status = result.status ?? 'unknown';
  const error = result.error ? ` (${result.error.message})` : '';
  return `exit ${status}${error}${output ? `: ${output}` : ''}`;
}

function assertAdbOk(result, action) {
  if (result.status !== 0 || result.error)
    throw new Error(`${action} failed: ${adbDetail(result)}`);
}

function adb(args, { silent = false, timeout = ADB_TIMEOUT_MS } = {}) {
  const result = adbResult(args, timeout);
  if (!silent) assertAdbOk(result, `adb ${args.join(' ')}`);
  return result.stdout ?? '';
}

function artifactName(name) {
  return String(name || 'artifact')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function awaitableSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function tap(x, y) {
  adb(['shell', 'input', 'tap', String(x), String(y)]);
}

function key(code) {
  adb(['shell', 'input', 'keyevent', code], { silent: true });
}

function screenshot(name) {
  const remote = '/sdcard/_photo_recipe_e2e.png';
  const local = `${SCREENSHOT_DIR}/${artifactName(name)}.png`;
  assertAdbOk(adbResult(['shell', 'screencap', '-p', remote]), `screenshot ${name}`);
  assertAdbOk(adbResult(['pull', remote, local]), `pull screenshot ${name}`);
  adb(['shell', 'rm', remote], { silent: true });
  return local;
}

function uiDump(name = 'dump') {
  const remote = '/sdcard/_photo_recipe_e2e.xml';
  const local = `${DUMP_DIR}/${artifactName(name)}.xml`;
  let lastError = '';

  for (let attempt = 1; attempt <= 8; attempt++) {
    if (existsSync(local)) rmSync(local, { force: true });
    const dump = adbResult(['shell', 'uiautomator', 'dump', remote], UI_DUMP_TIMEOUT_MS);
    if (dump.status !== 0 || dump.error) {
      lastError = `dump attempt ${attempt}: ${adbDetail(dump)}`;
      awaitableSleep(1200);
      continue;
    }
    const pull = adbResult(['pull', remote, local]);
    adb(['shell', 'rm', remote], { silent: true });
    if (pull.status !== 0 || pull.error) {
      lastError = `pull attempt ${attempt}: ${adbDetail(pull)}`;
      awaitableSleep(1200);
      continue;
    }
    const xml = readFileSync(local, 'utf8');
    if (xml.trim()) return xml;
    lastError = `empty dump attempt ${attempt}`;
    awaitableSleep(1200);
  }

  throw new Error(`UI dump failed for ${name}: ${lastError}`);
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function findNodeByAttr(xml, attr, value) {
  const nodeRe = /<node\b[^>]*\/?>/g;
  let match;
  while ((match = nodeRe.exec(xml)) !== null) {
    const node = match[0];
    if (!node.includes(`${attr}="${value}"`)) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (!bounds) continue;
    const left = Number(bounds[1]);
    const top = Number(bounds[2]);
    const right = Number(bounds[3]);
    const bottom = Number(bounds[4]);
    return {
      cx: Math.floor((left + right) / 2),
      cy: Math.floor((top + bottom) / 2),
      markup: node,
    };
  }
  return null;
}

function findByText(xml, text) {
  return findNodeByAttr(xml, 'text', text);
}

function findByContentDesc(xml, desc) {
  return findNodeByAttr(xml, 'content-desc', desc);
}

function xmlTextIncludes(xml, text) {
  return decodeXml(xml).includes(text);
}

function findAny(xml, texts) {
  for (const text of texts) {
    const node = findByText(xml, text) || findByContentDesc(xml, text);
    if (node) return node;
  }
  return null;
}

function dismissBlockingSystemDialog(name) {
  let xml = '';
  try {
    xml = uiDump(`${name}-system-dialog`);
  } catch {
    return false;
  }
  if (!xml.includes('package="com.android.systemui"')) return false;

  const cancelButton = findAny(xml, ['キャンセル', 'Cancel', '閉じる', 'Close']);
  if (!cancelButton) return false;
  tap(cancelButton.cx, cancelButton.cy);
  return true;
}

async function launchApp() {
  dismissBlockingSystemDialog('before-launch');
  key('KEYCODE_BACK');
  await sleep(500);
  adb(['shell', 'am', 'force-stop', PKG], { silent: true });
  await sleep(800);
  adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], { silent: true });
  await sleep(300);
  adb(['shell', 'am', 'start', '-n', ACT]);
  await sleep(5500);
  if (dismissBlockingSystemDialog('after-launch')) {
    await sleep(800);
    adb(['shell', 'am', 'start', '-n', ACT]);
    await sleep(3500);
  }
}

async function openPhotoRecipeScreen(namePrefix) {
  await launchApp();
  let xml = uiDump(`${namePrefix}-launch`);
  const addTab = findByText(xml, '追加');
  if (!addTab) throw new Error('追加 tab not found');
  tap(addTab.cx, addTab.cy);
  await sleep(1500);

  xml = uiDump(`${namePrefix}-add`);
  const photoButton =
    findByContentDesc(xml, '料理写真から推測, 写っている料理から下書き案を作成') ||
    findByText(xml, '料理写真から推測');
  if (!photoButton) throw new Error('料理写真から推測 button not found');
  tap(photoButton.cx, photoButton.cy);
  for (let attempt = 1; attempt <= 6; attempt++) {
    await sleep(1000);
    xml = uiDump(`${namePrefix}-photo-${attempt}`);
    if (xmlTextIncludes(xml, '写真から下書き')) break;
  }
  if (!xmlTextIncludes(xml, '写真から下書き')) throw new Error('photo recipe entry did not open');
  return xml;
}

function preflightCheck() {
  const devices = adb(['devices'], { silent: true });
  const authorized = devices
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List') && /\tdevice$/.test(line));
  if (authorized.length === 0)
    throw new Error(`No authorized Android device. adb output:\n${devices}`);
  if (!DEVICE_SERIAL) DEVICE_SERIAL = authorized[0].split('\t')[0].trim();
  const installed = adb(['shell', 'pm', 'list', 'packages', PKG], { silent: true });
  if (!installed.includes(PKG)) throw new Error(`${PKG} is not installed on ${DEVICE_SERIAL}`);
  console.log(`[OK] ${DEVICE_SERIAL} + ${PKG} verified`);
}

function snapshotPermission(permission) {
  const status = adb(['shell', 'cmd', 'package', 'check-permission', permission, PKG], {
    silent: true,
  }).trim();
  permissionSnapshot.set(permission, status === 'granted');
}

function resetPermissionPrompt(permission) {
  adb(['shell', 'pm', 'revoke', PKG, permission], { silent: true });
  adb(['shell', 'pm', 'clear-permission-flags', PKG, permission, 'user-set'], { silent: true });
  adb(['shell', 'pm', 'clear-permission-flags', PKG, permission, 'user-fixed'], { silent: true });
}

function restorePermission(permission) {
  const wasGranted = permissionSnapshot.get(permission);
  if (wasGranted) {
    adb(['shell', 'pm', 'grant', PKG, permission], { silent: true });
  } else {
    adb(['shell', 'pm', 'revoke', PKG, permission], { silent: true });
  }
}

async function denyPermissionDialog(namePrefix) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const xml = uiDump(`${namePrefix}-permission-${attempt}`);
    const denyButton = findAny(xml, [
      '許可しない',
      '許可しないでください',
      "Don't allow",
      'Don’t allow',
      'Deny',
    ]);
    if (denyButton) {
      tap(denyButton.cx, denyButton.cy);
      await sleep(1800);
      return;
    }
    await sleep(1000);
  }
  throw new Error('permission denial button was not shown');
}

async function refuseGalleryAccess(namePrefix) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const xml = uiDump(`${namePrefix}-permission-${attempt}`);
    const denyButton = findAny(xml, [
      '許可しない',
      '許可しないでください',
      "Don't allow",
      'Don’t allow',
      'Deny',
    ]);
    if (denyButton) {
      tap(denyButton.cx, denyButton.cy);
      await sleep(1800);
      return 'permission-denied';
    }

    if (xml.includes('package="com.google.android.photopicker"')) {
      key('KEYCODE_BACK');
      await sleep(1800);
      return 'picker-cancelled';
    }

    await sleep(1000);
  }
  throw new Error('gallery refusal path was not shown');
}

async function test(name, fn) {
  console.log(`▶ ${name}`);
  try {
    const detail = await fn();
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
    results.push({ name, status: 'PASS', detail: detail ?? '' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`❌ ${name} — ${detail}`);
    results.push({ name, status: 'FAIL', detail });
  }
}

async function testReleasePhotoRecipeEntry() {
  const xml = await openPhotoRecipeScreen('release-entry');
  screenshot('release-entry');
  const decoded = decodeXml(xml);
  if (!decoded.includes('写真から下書き')) throw new Error('photo recipe entry title was not shown');
  if (!findByContentDesc(xml, 'カメラで撮影') && !findByText(xml, 'カメラで撮影')) {
    throw new Error('camera button not found');
  }
  if (!findByContentDesc(xml, 'ギャラリーから選ぶ') && !findByText(xml, 'ギャラリーから選ぶ')) {
    throw new Error('gallery button not found');
  }
  if (decoded.includes('E2E料理写真で推測') || decoded.includes('E2E100画像を検証')) {
    throw new Error('release build exposes photo recipe E2E actions');
  }
  return 'release photo recipe entry has only production actions';
}

async function testCameraDenied() {
  resetPermissionPrompt('android.permission.CAMERA');
  const xml = await openPhotoRecipeScreen('camera-denied');
  const cameraButton = findByContentDesc(xml, 'カメラで撮影') || findByText(xml, 'カメラで撮影');
  if (!cameraButton) throw new Error('camera button not found');
  tap(cameraButton.cx, cameraButton.cy);
  await denyPermissionDialog('camera-denied');
  await sleep(1200);
  const resultXml = uiDump('camera-denied-result');
  screenshot('camera-denied-result');
  if (!xmlTextIncludes(resultXml, 'カメラの使用が許可されていません')) {
    throw new Error('camera denied message was not shown');
  }
  return 'camera denial handled';
}

async function testGalleryDenied() {
  for (const permission of [
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
    'android.permission.READ_EXTERNAL_STORAGE',
  ]) {
    resetPermissionPrompt(permission);
  }

  const xml = await openPhotoRecipeScreen('gallery-denied');
  const galleryButton =
    findByContentDesc(xml, 'ギャラリーから選ぶ') || findByText(xml, 'ギャラリーから選ぶ');
  if (!galleryButton) throw new Error('gallery button not found');
  tap(galleryButton.cx, galleryButton.cy);
  const refusal = await refuseGalleryAccess('gallery-denied');
  await sleep(1200);
  const resultXml = uiDump('gallery-denied-result');
  screenshot('gallery-denied-result');
  if (
    refusal === 'permission-denied' &&
    !xmlTextIncludes(resultXml, '写真ライブラリの使用が許可されていません')
  ) {
    throw new Error('gallery denied message was not shown');
  }
  if (refusal === 'picker-cancelled' && !xmlTextIncludes(resultXml, '写真から下書き')) {
    throw new Error('gallery picker cancellation did not return to photo recipe entry');
  }
  return refusal === 'permission-denied'
    ? 'gallery denial handled without selecting device files'
    : 'gallery picker cancellation handled without selecting device files';
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  だいどこ Android Photo Recipe Pixel E2E');
  console.log(`  ${new Date().toLocaleString('ja-JP')}`);
  console.log('═'.repeat(60));

  preflightCheck();
  for (const permission of [
    'android.permission.CAMERA',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
    'android.permission.READ_EXTERNAL_STORAGE',
  ]) {
    snapshotPermission(permission);
  }

  try {
    await test('P01 リリース料理写真入口 → テスト導線なし', testReleasePhotoRecipeEntry);
    await test('P02 カメラ権限拒否', testCameraDenied);
    await test('P03 写真ライブラリ権限拒否', testGalleryDenied);
  } finally {
    for (const permission of permissionSnapshot.keys()) restorePermission(permission);
  }

  const pass = results.filter((result) => result.status === 'PASS').length;
  const fail = results.filter((result) => result.status === 'FAIL').length;
  console.log('\n' + '═'.repeat(60));
  console.log(`  結果: PASS ${pass} / FAIL ${fail} / 合計 ${results.length}`);
  console.log('═'.repeat(60));
  console.log(`\n  スクリーンショット: ${SCREENSHOT_DIR}`);
  console.log(`  UI dump: ${DUMP_DIR}`);

  writeFileSync(
    'e2e/android-photo-recipe-e2e-result.json',
    JSON.stringify(
      { ts: new Date().toISOString(), pass, fail, total: results.length, results },
      null,
      2,
    ),
  );

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nFatal:', error);
  process.exit(1);
});
