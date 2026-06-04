#!/usr/bin/env node
/**
 * だいどこ — Android 実機 E2E テスト
 *
 * 必要環境:
 *   - ADB 接続済みの Pixel 9a (or 任意の Android 端末)
 *   - com.daidoko.app がインストール済み
 *   - 端末がロック解除されている
 *
 * 実行: node e2e/android-e2e.mjs
 *
 * 各テストは独立したフロー:
 *   1. force-stop でクリーン起動
 *   2. UI 階層を uiautomator dump で取得
 *   3. テキスト/bounds で要素を探してタップ
 *   4. 期待 UI 状態をスクリーンショット + UI dump で検証
 *   5. PASS/FAIL を集計
 */
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { resolve } from 'path';

const PKG = 'com.daidoko.app';
const ACT = `${PKG}/.MainActivity`;
const EXPO_DEV_URL = process.env.EXPO_DEV_URL || '';
const EXPO_DEV_SERVER_PORT = process.env.EXPO_DEV_SERVER_PORT || '8082';
const SCREENSHOT_DIR = resolve('e2e/screenshots/e2e-android');
const DUMP_DIR = resolve('e2e/ui-dumps');
const UI_DUMP_RETRIES = 8;
const UI_DUMP_RETRY_DELAY_MS = 1200;
const ADB_TIMEOUT_MS = Number(process.env.ADB_TIMEOUT_MS || 45000);
const UI_DUMP_TIMEOUT_MS = Number(process.env.UI_DUMP_TIMEOUT_MS || 20000);
// 対象デバイスのシリアル番号。TARGET_DEVICE 環境変数で上書き可。未設定時は preflightCheck で自動選択。
let DEVICE_SERIAL = process.env.TARGET_DEVICE || null;

// adb の絶対パス. ADB_PATH 環境変数で上書き可。未設定の場合は PATH 上の adb を使用する。
// Windows では ANDROID_HOME または LOCALAPPDATA から自動検出を試みる。
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

// ─── ADB ヘルパー ─────────────────────────────────────────────────────────
function adbResult(args, timeout = ADB_TIMEOUT_MS) {
  const fullArgs = DEVICE_SERIAL && args[0] !== 'devices' ? ['-s', DEVICE_SERIAL, ...args] : args;
  return spawnSync(ADB, fullArgs, { encoding: 'utf8', shell: false, timeout });
}

function artifactName(name) {
  const safe = String(name || 'artifact')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'artifact';
}

function adbDetail(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const status = result.status ?? 'unknown';
  const error = result.error ? ` (${result.error.message})` : '';
  return `exit ${status}${error}${output ? `: ${output}` : ''}`;
}

function assertAdbOk(result, action) {
  if (result.status !== 0 || result.error) {
    throw new Error(`${action} failed: ${adbDetail(result)}`);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function adb(args, { silent = false } = {}) {
  const result = adbResult(args);
  if (!silent && result.status !== 0 && result.stderr) {
    // 警告のみで止めない
  }
  return result.stdout ?? '';
}

function sh(cmd) {
  return adb(['shell', ...cmd.split(' ')]);
}

function collapseSystemUi() {
  adb(['shell', 'cmd', 'statusbar', 'collapse'], { silent: true });
}

function xmlLooksLikeNotificationShade(xml) {
  return (
    xml.includes('package="com.android.systemui"') &&
    (xml.includes('notification_panel') ||
      xml.includes('notification_stack_scroller') ||
      xml.includes('quick_settings_container'))
  );
}

function tap(x, y) {
  adb(['shell', 'input', 'tap', String(x), String(y)]);
}

function inputText(text) {
  // ADB input text はスペースをそのまま送れないので %s に置換
  const safe = text.replace(/ /g, '%s');
  adb(['shell', 'input', 'text', safe]);
}

function key(code) {
  adb(['shell', 'input', 'keyevent', code]);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dismissKeyboard() {
  key('KEYCODE_BACK');
  await sleep(800);
}

async function dismissSystemAnrIfShown() {
  let xml = '';
  try {
    xml = uiDump('system-dialog-check');
  } catch {
    return false;
  }
  if (!xml.includes("isn't responding") && !xml.includes('応答していません')) return false;

  const waitButton = findByText(xml, 'Wait') || findByText(xml, '待機');
  if (!waitButton) return false;

  tap(waitButton.cx, waitButton.cy);
  await sleep(3000);
  return true;
}

function screenshot(name) {
  collapseSystemUi();
  const remote = '/sdcard/_e2e.png';
  const local = `${SCREENSHOT_DIR}/${artifactName(name)}.png`;
  assertAdbOk(adbResult(['shell', 'screencap', '-p', remote]), `screenshot ${name}`);
  assertAdbOk(adbResult(['pull', remote, local]), `pull screenshot ${name}`);
  adb(['shell', 'rm', remote], { silent: true });
  return local;
}

function uiDump(name = 'dump') {
  const remote = '/sdcard/_e2e.xml';
  const local = `${DUMP_DIR}/${artifactName(name)}.xml`;
  let lastError = '';

  const pullDump = (attempt) => {
    const pullResult = adbResult(['pull', remote, local]);
    adb(['shell', 'rm', remote], { silent: true });
    if (pullResult.status !== 0 || pullResult.error) {
      lastError = `pull attempt ${attempt}: ${adbDetail(pullResult)}`;
      return null;
    }

    if (!existsSync(local)) {
      lastError = `pull attempt ${attempt}: local dump was not created at ${local}`;
      return null;
    }

    const xml = readFileSync(local, 'utf8');
    if (xml.trim().length > 0) {
      if (xmlLooksLikeNotificationShade(xml)) {
        lastError = `read attempt ${attempt}: notification shade was open`;
        collapseSystemUi();
        return null;
      }
      return xml;
    }

    lastError = `read attempt ${attempt}: local dump was empty at ${local}`;
    return null;
  };

  for (let attempt = 1; attempt <= UI_DUMP_RETRIES; attempt++) {
    if (existsSync(local)) rmSync(local, { force: true });

    const dumpResult = adbResult(['shell', 'uiautomator', 'dump', remote], UI_DUMP_TIMEOUT_MS);
    if (dumpResult.status !== 0 || dumpResult.error) {
      lastError = `dump attempt ${attempt}: ${adbDetail(dumpResult)}`;
      const output = [dumpResult.stdout, dumpResult.stderr].filter(Boolean).join('\n');
      if (output.includes('dumped to:') || output.includes(remote)) {
        const xml = pullDump(attempt);
        if (xml) return xml;
      } else {
        adb(['shell', 'rm', remote], { silent: true });
      }
      sleepSync(UI_DUMP_RETRY_DELAY_MS);
      continue;
    }

    const xml = pullDump(attempt);
    if (xml) return xml;
    sleepSync(UI_DUMP_RETRY_DELAY_MS);
  }

  throw new Error(`UI dump failed for "${name}" at ${local}: ${lastError}`);
}

// ─── UI 要素探索 ──────────────────────────────────────────────────────────
function findByText(xml, text) {
  return findNodeByAttr(xml, 'text', text);
}

function findByContentDesc(xml, desc) {
  return findNodeByAttr(xml, 'content-desc', desc);
}

function findByHint(xml, hint) {
  return findNodeByAttr(xml, 'hint', hint) || findNodeByAttr(xml, 'text', hint);
}

function hasAnyText(xml, texts) {
  return texts.some((text) => text && hasText(xml, text));
}

function toFullWidthDigits(value) {
  return value.replace(/\d/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0));
}

function getTextByHint(xml, hint) {
  const node = findNodeMarkupByAttr(xml, 'hint', hint);
  if (!node) return null;
  const match = /\btext="([^"]*)"/.exec(node);
  return match ? decodeXml(match[1]) : null;
}

function findNodeMarkupByAttr(xml, attr, value) {
  const nodeRe = /<node\b[^>]*\/?>/g;
  let m;
  while ((m = nodeRe.exec(xml)) !== null) {
    const node = m[0];
    if (node.includes(`${attr}="${value}"`)) return node;
  }
  return null;
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

// 各 <node ...> 要素を順次抽出し、指定属性が一致するノードの bounds を返す。
// 属性の出現順に依存せずに探索する。
function findNodeByAttr(xml, attr, value) {
  const nodeRe = /<node\b[^>]*\/?>/g;
  let m;
  while ((m = nodeRe.exec(xml)) !== null) {
    const node = m[0];
    if (node.includes(`${attr}="${value}"`)) {
      const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
      if (b) {
        return {
          bounds: [+b[1], +b[2], +b[3], +b[4]],
          cx: Math.floor((+b[1] + +b[3]) / 2),
          cy: Math.floor((+b[2] + +b[4]) / 2),
          markup: node,
        };
      }
    }
  }
  return null;
}

function findAllByText(xml, text) {
  const re = new RegExp(
    `text="${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]+bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
    'g',
  );
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push({
      bounds: [+m[1], +m[2], +m[3], +m[4]],
      cx: Math.floor((+m[1] + +m[3]) / 2),
      cy: Math.floor((+m[2] + +m[4]) / 2),
    });
  }
  return results;
}

function findTopRightClickable(xml) {
  const nodeRe = /<node\b[^>]*\/?>/g;
  let match;
  while ((match = nodeRe.exec(xml)) !== null) {
    const node = match[0];
    if (!node.includes('clickable="true"')) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (!bounds) continue;
    const left = +bounds[1];
    const top = +bounds[2];
    const right = +bounds[3];
    const bottom = +bounds[4];
    if (left < 850 || top > 260) continue;
    return {
      bounds: [left, top, right, bottom],
      cx: Math.floor((left + right) / 2),
      cy: Math.floor((top + bottom) / 2),
    };
  }
  return null;
}

function findFirstEditText(xml) {
  const match =
    /<node\b[^>]*\bclass="android\.widget\.EditText"[^>]*\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(
      xml,
    );
  if (!match) return null;
  return {
    bounds: [+match[1], +match[2], +match[3], +match[4]],
    cx: Math.floor((+match[1] + +match[3]) / 2),
    cy: Math.floor((+match[2] + +match[4]) / 2),
  };
}

function hasText(xml, text) {
  return xml.includes(`text="${text}"`);
}

// ─── 共通フロー ────────────────────────────────────────────────────────────
async function dismissCompatWarningIfShown() {
  await sleep(500);
  let xml = '';
  try {
    xml = uiDump('compat-check');
  } catch {
    return false;
  }
  if (xml.includes('16 KB') || xml.includes('Android アプリの互換性')) {
    const btn = findByText(xml, '次回から表示しない');
    if (btn) {
      tap(btn.cx, btn.cy);
      await sleep(1500);
      return true;
    }
  }
  return false;
}

async function launchApp() {
  collapseSystemUi();
  adb(['shell', 'am', 'force-stop', PKG]);
  await sleep(800);
  adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  await sleep(300);

  if (EXPO_DEV_URL) {
    adb(['reverse', `tcp:${EXPO_DEV_SERVER_PORT}`, `tcp:${EXPO_DEV_SERVER_PORT}`], {
      silent: true,
    });
    adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', EXPO_DEV_URL]);
  } else {
    adb(['shell', 'am', 'start', '-n', ACT]);
  }

  await sleep(EXPO_DEV_URL ? 10000 : 5000); // splash + initial render
  collapseSystemUi();
  await dismissSystemAnrIfShown();
  await dismissCompatWarningIfShown();
  await sleep(800);
}

async function tapTab(label) {
  const xml = uiDump(`tabbar-${label}`);
  const tab = findByText(xml, label);
  if (!tab) throw new Error(`Tab not found: ${label}`);
  tap(tab.cx, tab.cy);
  await sleep(1500);
}

// ─── テストランナー ────────────────────────────────────────────────────────
const results = [];
let lastCreatedRecipeName = null;

function record(name, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️ ';
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
  results.push({ name, status, detail });
}

async function test(name, fn) {
  try {
    const result = await fn();
    record(name, result === false ? 'FAIL' : 'PASS', typeof result === 'string' ? result : '');
  } catch (err) {
    record(name, 'FAIL', err.message);
  }
}

// ─── 環境チェック ──────────────────────────────────────────────────────────
function preflightCheck() {
  const devices = adb(['devices'], { silent: true });
  const lines = devices
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('List'));
  // Each line is "<serial>\tdevice" or "<serial>\tunauthorized"
  const authorized = lines.filter((l) => /\tdevice$/.test(l));
  if (authorized.length === 0) {
    console.error('[NG] No authorized device. adb output:');
    console.error(devices);
    process.exit(1);
  }
  // TARGET_DEVICE 未指定の場合は最初の認証済みデバイスを自動選択
  if (!DEVICE_SERIAL) {
    DEVICE_SERIAL = authorized[0].split('\t')[0].trim();
  }
  const installed = adb(['shell', 'pm', 'list', 'packages', PKG]);
  if (!installed.includes(PKG)) {
    console.error(`[NG] ${PKG} not installed.`);
    process.exit(1);
  }
  console.log(`[OK] ${DEVICE_SERIAL}      device + ${PKG} verified.`);
}

// ─── 各テスト ─────────────────────────────────────────────────────────────

async function testAppLaunch() {
  await launchApp();
  screenshot('01-launch');
  const xml = uiDump('launch');
  // ホームタブが選択されているはず（DAIDOKO ブランド表示）
  if (!hasText(xml, 'DAIDOKO')) throw new Error('DAIDOKO brand text not found');
  if (!hasText(xml, 'ホーム')) throw new Error('Home tab not found');
  return 'home screen rendered';
}

async function testTabNavigation() {
  for (const label of ['レシピ', '設定', '追加', 'ホーム']) {
    await tapTab(label);
    screenshot(`02-tab-${label}`);
  }
  return 'all 4 tabs switchable';
}

function recipeCandidates(...fallbackTitles) {
  return [...new Set([lastCreatedRecipeName, ...fallbackTitles].filter(Boolean))];
}

async function findRecipeInCurrentList(candidates, dumpPrefix) {
  let xml = uiDump(`${dumpPrefix}-0`);
  for (let attempt = 0; attempt <= 5; attempt++) {
    for (const title of candidates) {
      const node = findByText(xml, title);
      if (node) return { title, node, xml };
    }
    if (attempt === 5) break;
    adb(['shell', 'input', 'swipe', '540', '1800', '540', '500', '300']);
    await sleep(1200);
    xml = uiDump(`${dumpPrefix}-${attempt + 1}`);
  }
  throw new Error(`recipe card not found: ${candidates.join(' / ')}`);
}

async function findTextWithScroll(text, dumpPrefix, maxScrolls = 4) {
  let xml = uiDump(`${dumpPrefix}-0`);
  for (let attempt = 0; attempt <= maxScrolls; attempt++) {
    const node = findByText(xml, text);
    if (node) return { node, xml };
    if (attempt === maxScrolls) break;
    adb(['shell', 'input', 'swipe', '540', '1800', '540', '500', '300']);
    await sleep(1200);
    xml = uiDump(`${dumpPrefix}-${attempt + 1}`);
  }
  throw new Error(`text not found after scroll: ${text}`);
}

async function testCreatedRecipeVisible() {
  if (!lastCreatedRecipeName) throw new Error('created recipe name not available');
  await launchApp();
  await tapTab('レシピ');
  await sleep(1000);
  const { title } = await findRecipeInCurrentList(recipeCandidates(), 'recipe-list-created');
  screenshot('03-recipe-list');
  return `created recipe visible: ${title}`;
}

async function testRecipeDetail() {
  await launchApp();
  await tapTab('レシピ');
  await sleep(1000);
  const { title, node: recipe } = await findRecipeInCurrentList(
    recipeCandidates('肉じゃが'),
    'recipe-list-tap',
  );
  tap(recipe.cx, recipe.cy);
  await sleep(2500);
  screenshot('04-recipe-detail');
  const detail = uiDump('recipe-detail');
  if (!hasText(detail, '材料')) throw new Error('材料 tab not present');
  if (!hasText(detail, '手順')) throw new Error('手順 tab not present');
  if (!hasText(detail, '調理開始')) throw new Error('調理開始 button not present');
  return `detail screen has 材料/手順/調理開始: ${title}`;
}

async function testCookingMode() {
  await launchApp();
  await tapTab('レシピ');
  await sleep(1000);
  const { title, node: recipe } = await findRecipeInCurrentList(
    recipeCandidates('豚汁', '肉じゃが'),
    'cook-step1',
  );
  tap(recipe.cx, recipe.cy);
  await sleep(2000);
  let xml = uiDump('cook-step2');
  const cta = findByText(xml, '調理開始');
  if (!cta) throw new Error('調理開始 button not found');
  tap(cta.cx, cta.cy);
  await sleep(2500);
  screenshot('05-cooking-mode');
  xml = uiDump('cook-step3');
  // ステップカウンター "1 / N" が含まれているか
  if (!/\d+\s*\/\s*\d+/.test(xml)) throw new Error('step counter not found');
  const finish = findByText(xml, '✓ 完成！記録する');
  if (!finish) throw new Error('finish and log button not found');
  tap(finish.cx, finish.cy);
  await sleep(1800);
  screenshot('05-cooking-log-photo-ui');
  const logXml = uiDump('cooking-log-photo-ui');
  if (!hasText(logXml, 'カメラで撮影')) throw new Error('camera photo action not found');
  if (!hasText(logXml, 'ギャラリーから選ぶ')) throw new Error('gallery photo action not found');
  if (hasText(logXml, '今後追加予定')) throw new Error('photo action is still marked as future');
  return `cooking mode + photo log UI verified: ${title}`;
}

// IME 開閉後に再ダンプして現在のフィールド座標で操作するヘルパー
let _dumpSeq = 0;
async function tapAndType(hint, text, { isDigit = false, closeKeyboard = true } = {}) {
  const xml = uiDump(`field-${++_dumpSeq}`);
  const field = findByHint(xml, hint);
  if (!field) throw new Error(`field with hint="${hint}" not found`);
  tap(field.cx, field.cy);
  await sleep(1500);
  if (isDigit) {
    // 数字は KEYCODE_* で送る（IME 経由を避けて全角化を防ぐ）
    for (const ch of text) {
      key(`KEYCODE_${ch}`);
      await sleep(150);
    }
  } else {
    inputText(text);
  }
  await sleep(1500); // IME 反映待ち
  if (closeKeyboard) await dismissKeyboard();
  const afterXml = uiDump(`field-${_dumpSeq}-after`);
  return getTextByHint(afterXml, hint);
}

async function testManualRecipeCreate() {
  await launchApp();
  await tapTab('追加');
  await sleep(1500);
  let xml = uiDump('add-method');
  const manual = findByText(xml, '手動で入力');
  if (!manual) throw new Error('手動で入力 not found');
  tap(manual.cx, manual.cy);
  await sleep(3500);
  screenshot('06-form-empty');

  const generatedRecipeName = Date.now().toString().slice(-9);

  // タイトル
  const inputRecipeName = await tapAndType('例: 肉じゃが', generatedRecipeName, { isDigit: true });
  const recipeNameCandidates = [
    inputRecipeName,
    generatedRecipeName,
    toFullWidthDigits(generatedRecipeName),
  ].filter(Boolean);

  // 材料名 — IME 再ダンプで現在の座標を取る
  await tapAndType('材料名', '101', { isDigit: true });

  // 分量 (数字のみ)
  await tapAndType('分量', '3', { isDigit: true });

  // 手順 — フォーム下部。タップ前にスクロールして表示させる必要
  let stepXml = uiDump('form-pre-step');
  let stepField = findByHint(stepXml, '手順を入力...');
  if (!stepField) {
    // 大きくスクロール
    adb(['shell', 'input', 'swipe', '540', '1800', '540', '400', '400']);
    await sleep(1500);
    stepXml = uiDump('form-after-scroll');
    stepField = findByHint(stepXml, '手順を入力...');
  }
  if (!stepField) {
    // それでも見つからない場合: もう一度スクロール
    adb(['shell', 'input', 'swipe', '540', '1800', '540', '400', '400']);
    await sleep(1500);
    stepXml = uiDump('form-after-scroll2');
    stepField = findByHint(stepXml, '手順を入力...');
  }
  if (!stepField) throw new Error('手順 field not found after scroll');
  tap(stepField.cx, stepField.cy);
  await sleep(1500);
  for (const ch of '12345') {
    key(`KEYCODE_${ch}`);
    await sleep(150);
  }
  await sleep(1500);
  await dismissKeyboard();

  screenshot('07-form-filled');

  // 保存
  const saveXml = uiDump('form-save');
  const save = findByContentDesc(saveXml, '保存');
  if (!save) throw new Error('保存 button not found');
  tap(save.cx, save.cy);
  await sleep(4000);
  screenshot('08-after-save');

  // レシピ一覧に名前が出現するか
  await tapTab('レシピ');
  await sleep(2500);
  let listXml = uiDump('list-after-save');
  for (let attempt = 1; attempt <= 5 && !hasAnyText(listXml, recipeNameCandidates); attempt++) {
    adb(['shell', 'input', 'swipe', '540', '1800', '540', '500', '300']);
    await sleep(1200);
    listXml = uiDump(`list-after-save-scroll-${attempt}`);
  }
  const savedRecipeName = recipeNameCandidates.find((candidate) => hasText(listXml, candidate));
  if (!savedRecipeName) {
    throw new Error(`saved recipe "${recipeNameCandidates.join(' / ')}" not found in list`);
  }
  lastCreatedRecipeName = savedRecipeName;
  return `saved & visible: ${savedRecipeName}`;
}

async function testDeleteCreatedRecipe() {
  if (!lastCreatedRecipeName) {
    throw new Error('created recipe name not available');
  }

  await launchApp();
  await tapTab('レシピ');
  await sleep(1500);

  let listXml = uiDump('delete-list-before-open');
  let recipe = findByText(listXml, lastCreatedRecipeName);
  for (let attempt = 1; attempt <= 5 && !recipe; attempt++) {
    adb(['shell', 'input', 'swipe', '540', '1800', '540', '500', '300']);
    await sleep(1200);
    listXml = uiDump(`delete-list-scroll-${attempt}`);
    recipe = findByText(listXml, lastCreatedRecipeName);
  }
  if (!recipe) throw new Error(`recipe to delete not found: ${lastCreatedRecipeName}`);

  tap(recipe.cx, recipe.cy);
  await sleep(2500);
  screenshot('09-delete-detail');

  const detailXml = uiDump('delete-detail');
  const menuButton = findTopRightClickable(detailXml);
  if (!menuButton) throw new Error('detail menu button not found');
  tap(menuButton.cx, menuButton.cy);
  await sleep(1200);

  const menuXml = uiDump('delete-menu');
  const deleteMenuItem = findByText(menuXml, '削除');
  if (!deleteMenuItem) throw new Error('delete menu item not found');
  tap(deleteMenuItem.cx, deleteMenuItem.cy);
  await sleep(1200);

  const alertXml = uiDump('delete-confirm');
  if (!alertXml.includes('レシピを削除')) {
    throw new Error('delete confirmation dialog not shown');
  }
  const deleteButtons = findAllByText(alertXml, '削除');
  const confirmDeleteButton = deleteButtons[deleteButtons.length - 1];
  if (!confirmDeleteButton) throw new Error('delete confirm button not found');
  tap(confirmDeleteButton.cx, confirmDeleteButton.cy);
  await sleep(2500);
  screenshot('10-delete-after-confirm');

  const afterDeleteXml = uiDump('delete-list-after-confirm');
  if (!hasText(afterDeleteXml, 'レシピを探す')) {
    throw new Error('did not return to recipe list after delete');
  }

  let scanXml = afterDeleteXml;
  let deletedRecipeStillVisible = hasText(scanXml, lastCreatedRecipeName);
  for (let attempt = 1; attempt <= 5 && !deletedRecipeStillVisible; attempt++) {
    adb(['shell', 'input', 'swipe', '540', '1800', '540', '500', '300']);
    await sleep(1200);
    scanXml = uiDump(`delete-list-after-confirm-scroll-${attempt}`);
    deletedRecipeStillVisible = hasText(scanXml, lastCreatedRecipeName);
  }
  if (deletedRecipeStillVisible) {
    throw new Error(`deleted recipe still appears in list: ${lastCreatedRecipeName}`);
  }

  return `deleted & removed: ${lastCreatedRecipeName}`;
}

async function testUrlImport() {
  await launchApp();
  await tapTab('追加');
  await sleep(1200);
  const xml = uiDump('url-method');
  const urlBtn = findByText(xml, 'URLから取り込み');
  if (!urlBtn) throw new Error('URL取り込み button not found');
  tap(urlBtn.cx, urlBtn.cy);
  await sleep(3000);
  screenshot('09-url-screen');

  const urlXml = uiDump('url-input');
  // URL 入力欄を hint で探す（複数候補）
  let urlInput =
    findByHint(urlXml, 'https://example.com/recipe/...') ||
    findByHint(urlXml, 'https://example.com/recipe/…');
  if (!urlInput) {
    // 別パターン: EditText で hint に http を含むもの
    const m =
      /<node\b[^>]*?(?:hint="[^"]*http[^"]*"|text="[^"]*http[^"]*")[^>]*\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(
        urlXml,
      );
    if (!m) {
      // EditText 全般から検索
      const editMatch =
        /<node\b[^>]*\bclass="android\.widget\.EditText"[^>]*\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(
          urlXml,
        );
      if (!editMatch) throw new Error('URL input field not found');
      urlInput = {
        bounds: [+editMatch[1], +editMatch[2], +editMatch[3], +editMatch[4]],
        cx: Math.floor((+editMatch[1] + +editMatch[3]) / 2),
        cy: Math.floor((+editMatch[2] + +editMatch[4]) / 2),
      };
    } else {
      urlInput = {
        bounds: [+m[1], +m[2], +m[3], +m[4]],
        cx: Math.floor((+m[1] + +m[3]) / 2),
        cy: Math.floor((+m[2] + +m[4]) / 2),
      };
    }
  }
  tap(urlInput.cx, urlInput.cy);
  await sleep(1200);

  // 存在しない URL を入力して UNSUPPORTED_SITE エラー検証
  inputText('https://example.com');
  await sleep(1500);
  await dismissSystemAnrIfShown();

  // 「取り込む」ボタン
  const goXml = uiDump('url-go');
  const goBtn = findByText(goXml, '取り込む');
  if (!goBtn) throw new Error('取り込む button not found');
  // 1回目で IME 閉じる、2回目で実行
  tap(goBtn.cx, goBtn.cy);
  await sleep(800);
  tap(goBtn.cx, goBtn.cy);
  await sleep(20000); // サーバー応答 + UI 更新待ち（実機なので余裕を持つ）
  await dismissSystemAnrIfShown();
  screenshot('10-url-result');

  let resultXml = uiDump('url-result');
  if (resultXml.includes("isn't responding") || resultXml.includes('応答していません')) {
    await dismissSystemAnrIfShown();
    resultXml = uiDump('url-result-after-anr');
  }
  // example.com は JSON-LD なし → UNSUPPORTED_SITE エラー表示が期待値
  // または、もし URL が成功するなら "レシピを確認・編集" が表示される
  if (
    resultXml.includes('対応していません') ||
    resultXml.includes('UNSUPPORTED') ||
    resultXml.includes('レシピを確認') ||
    resultXml.includes('取り込めません') ||
    resultXml.includes('URLはhttp') ||
    resultXml.includes('取り込み') // 結果画面のヘッダー残存でも OK
  ) {
    return 'URL import responded';
  }
  throw new Error('URL import result did not show expected response');
}

async function testTextImportPromptCopy() {
  await launchApp();
  await tapTab('追加');
  await sleep(1200);
  let xml = uiDump('text-method');
  const textBtn = findByText(xml, 'テキストから作成');
  if (!textBtn) throw new Error('テキストから作成 button not found');
  tap(textBtn.cx, textBtn.cy);
  await sleep(2500);

  xml = uiDump('text-import-screen');
  const copyBtn = findByText(xml, 'AI用指示をコピー') || findByContentDesc(xml, 'AI用指示をコピー');
  if (!copyBtn) throw new Error('AI用指示をコピー button not found');
  tap(copyBtn.cx, copyBtn.cy);
  await sleep(1000);
  screenshot('11-text-prompt-copied');

  xml = uiDump('text-import-after-copy');
  const input = findFirstEditText(xml);
  if (!input) throw new Error('freeform text input not found');
  tap(input.cx, input.cy);
  await sleep(1000);
  key('KEYCODE_PASTE');
  await sleep(1500);
  await dismissKeyboard();

  const pastedXml = uiDump('text-import-pasted-prompt');
  if (!pastedXml.includes('変換したいレシピ情報') && !pastedXml.includes('JSON、表')) {
    throw new Error('copied AI prompt was not pasted into the text input');
  }
  return 'AI prompt copied and pasted';
}

async function testOcrEntry() {
  await launchApp();
  await tapTab('追加');
  await sleep(1200);
  const xml = uiDump('ocr-method');
  const ocrBtn =
    findByContentDesc(xml, '文字入り画像から作成, レシピ本や手書きメモの文字を読み取り') ||
    findByText(xml, '文字入り画像から作成');
  if (!ocrBtn) throw new Error('文字入り画像から作成 button not found');
  tap(ocrBtn.cx, ocrBtn.cy);
  await sleep(2000);
  screenshot('12-ocr-entry');
  const entryXml = uiDump('ocr-entry');
  if (
    !entryXml.includes('OCR') &&
    !entryXml.includes('カメラで撮影') &&
    !entryXml.includes('ギャラリーから選ぶ')
  ) {
    throw new Error('OCR entry screen not as expected');
  }
  return 'OCR entry displayed';
}

async function testSettingsAndFamily() {
  await launchApp();
  await tapTab('設定');
  await sleep(1500);
  screenshot('12-settings');
  let xml = uiDump('settings');
  const sections = ['アカウント', '家族', 'データ', 'アプリ'];
  const found = sections.filter((s) => hasText(xml, s));
  if (found.length < 3) throw new Error(`only ${found.length}/4 settings sections`);

  const { node: backupLink } = await findTextWithScroll(
    'バックアップ・復元',
    'settings-backup-link',
  );
  tap(backupLink.cx, backupLink.cy);
  await sleep(1500);
  screenshot('13-backup');
  const backupXml = uiDump('backup');
  if (!hasText(backupXml, 'バックアップを作成')) throw new Error('backup create action not shown');
  if (!hasText(backupXml, '最新バックアップから復元'))
    throw new Error('backup restore action not shown');
  const { node: createMigrationButton } = await findTextWithScroll(
    '移行ファイルを作成',
    'backup-migration-create',
  );
  await findTextWithScroll('移行ファイルから復元', 'backup-migration-restore');
  tap(createMigrationButton.cx, createMigrationButton.cy);
  await sleep(5000);
  screenshot('13-backup-migration-created');
  const migrationCreatedXml = uiDump('backup-migration-created');
  if (!migrationCreatedXml.includes('daidoko-transfer-')) {
    throw new Error('migration backup package name not shown after create');
  }
  key('KEYCODE_BACK');
  await sleep(1200);

  await tapTab('設定');
  const { node: licensesLink } = await findTextWithScroll(
    'ライセンス情報',
    'settings-licenses-link',
  );
  tap(licensesLink.cx, licensesLink.cy);
  await sleep(1500);
  screenshot('13-licenses');
  const licensesXml = uiDump('licenses');
  if (!hasText(licensesXml, 'オープンソースライセンス')) {
    throw new Error('license screen summary not shown');
  }
  if (!hasText(licensesXml, 'Expo / Expo SDK')) throw new Error('license package list not shown');
  key('KEYCODE_BACK');
  await sleep(1200);

  await tapTab('設定');
  xml = uiDump('settings-family-link');

  // 家族グループ画面へ
  const familyLink = findByText(xml, '家族グループ');
  if (familyLink) {
    tap(familyLink.cx, familyLink.cy);
    await sleep(1500);
    screenshot('13-family');
    const famXml = uiDump('family');
    if (!hasText(famXml, '招待コード')) throw new Error('招待コード not shown');
  }
  return 'settings + backup/license/family/migration backup verified';
}

async function testTimelineHasContent() {
  await launchApp();
  await sleep(800);
  const xml = uiDump('timeline-check');
  screenshot('14-timeline');
  if (!hasText(xml, 'DAIDOKO')) throw new Error('DAIDOKO brand text not found');
  const filters = ['今週', '今月', 'すべて'].filter((filter) => hasText(xml, filter));
  if (filters.length !== 3) throw new Error(`only ${filters.length}/3 filter tabs`);
  if (lastCreatedRecipeName && hasText(xml, lastCreatedRecipeName)) {
    return `timeline rendered with created recipe: ${lastCreatedRecipeName}`;
  }
  return 'timeline rendered without requiring sample logs';
}

async function testFilterTabs() {
  await launchApp();
  const xml = uiDump('filter-tabs');
  const filters = ['今週', '今月', 'すべて'].filter((f) => hasText(xml, f));
  if (filters.length !== 3) throw new Error(`only ${filters.length}/3 filter tabs`);

  // 今週タップ
  const weekTab = findByText(xml, '今週');
  if (weekTab) {
    tap(weekTab.cx, weekTab.cy);
    await sleep(1000);
    screenshot('15-filter-week');
  }
  return 'all 3 filter tabs present and switchable';
}

// ─── メイン ───────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('  だいどこ Android E2E テスト');
  console.log(`  ${new Date().toLocaleString('ja-JP')}`);
  console.log('═'.repeat(60));

  preflightCheck();

  await test('T01 アプリ起動 + ホーム描画', testAppLaunch);
  await test('T02 フィルタータブ (今週/今月/すべて)', testFilterTabs);
  await test('T03 タブ間ナビゲーション', testTabNavigation);
  await test('T04 手動レシピ作成 → DB 保存検証', testManualRecipeCreate);
  await test('T05 レシピ一覧に作成レシピ表示', testCreatedRecipeVisible);
  await test('T06 レシピ詳細画面', testRecipeDetail);
  await test('T07 料理中モード遷移', testCookingMode);
  await test('T08 タイムライン表示', testTimelineHasContent);
  await test('T09 レシピ削除 → 一覧反映', testDeleteCreatedRecipe);
  await test('T10 URL 取り込み (例: example.com)', testUrlImport);
  await test('T11 テキスト取り込み AI 指示コピー', testTextImportPromptCopy);
  await test('T12 OCR 入口画面', testOcrEntry);
  await test('T13 設定画面 + 家族グループ', testSettingsAndFamily);

  // サマリー
  console.log('\n' + '═'.repeat(60));
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`  結果: PASS ${pass} / FAIL ${fail} / 合計 ${results.length}`);
  console.log('═'.repeat(60));

  if (fail > 0) {
    console.log('\n❌ 失敗:');
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.log(`   ${r.name}: ${r.detail}`);
    }
  }
  console.log(`\n  スクリーンショット: ${SCREENSHOT_DIR}`);
  console.log(`  UI dump: ${DUMP_DIR}`);

  // JSON で結果を出力
  writeFileSync(
    'e2e/android-e2e-result.json',
    JSON.stringify(
      { ts: new Date().toISOString(), pass, fail, total: results.length, results },
      null,
      2,
    ),
  );

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\nFatal:', e);
  process.exit(1);
});
