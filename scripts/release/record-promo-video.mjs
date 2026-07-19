/**
 * Google Play ストア掲載用のプロモーション動画（YouTube 埋め込み）の素材を、
 * 接続中の端末/エミュレータから機械的に収録する。
 *
 * 仕組み: capture-store-screenshots.mjs と同じ操作パターン（force-stop →
 * ディープリンクでコールドスタート → デモモードでステータスバー固定）を使い、
 * `adb shell screenrecord` で各シーンを個別の mp4 として録画する。
 * 编集（トリム・結合・タイトルカード）は edit-promo-video.mjs（ffmpeg）が別途行う。
 *
 * 重要: Android の screenrecord は画面が完全に静止しているとフレームを
 * 1枚しか出力しない（vsync/コンポジタ更新駆動のため）。そのため録画を
 * バックグラウンドで開始した状態でスワイプ操作を注入し、確実に動きのある
 * 映像にしている（録画完了は --time-limit 到達を待つ）。
 *
 * 前提: capture-store-screenshots.mjs と同じ（サンプルデータ入りリリース APK
 * インストール済み・1080x2400 エミュレータ推奨）。
 *
 * 使い方:
 *   node scripts/release/record-promo-video.mjs [--serial <serial>] [--out <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUT = path.join(ROOT, 'Temp/promo-video-raw');
const PACKAGE = 'com.daidoko.app';
const SCHEME = 'daidoko';

const args = parseArgs(process.argv.slice(2));
const RECIPE_ID = args.recipe ?? 'recipe-1';

/**
 * シーン定義。route はディープリンク先。actions は route を開いた後に行う
 * タップ等の演出（アプリの「動き」を見せるための最小限の操作）。
 * durationMs は screenrecord の録画時間（route 起動後の待機込みで見積もる）。
 */
const SCENES = [
  {
    file: '01-home.mp4',
    route: '',
    settleMs: 1800,
    durationMs: 3200,
    label: 'ホーム（家族の調理タイムライン）',
    actions: [
      { swipeNorm: [0.5, 0.7, 0.5, 0.35], atMs: 900 }, // 一覧を少し送る
      { swipeNorm: [0.5, 0.4, 0.5, 0.7], atMs: 2000 }, // 戻して尺を確保
    ],
  },
  {
    file: '02-photo-to-recipe-intro.mp4',
    route: 'recipes/import-photo',
    settleMs: 1800,
    durationMs: 7000,
    label: '写真からレシピ（ギャラリー選択→確認ダイアログ）',
    // 実フローを見せる: ギャラリーを開き、お店の料理写真（チャーハン）を選んで
    // 確認ダイアログまで。「レシピをつくる」は押さない（AI無料枠を消費するため）。
    // 前提: Temp/promo-photos の3枚を adb push 済み・フォトピッカーの並びは
    // 明太釜玉うどん/サンプル/麻辣湯うどん/チャーハン(2段目左)。
    actions: [
      { tapNorm: [0.5, 0.656], atMs: 1000 }, // 「ギャラリーから選ぶ」
      { tapNorm: [0.165, 0.74], atMs: 3400 }, // チャーハン写真（ピッカー2段目左）
    ],
  },
  {
    file: '03-recipe-detail-photo.mp4',
    route: 'recipes',
    settleMs: 2200,
    durationMs: 5000,
    label: 'AI生成レシピ詳細（実写真の表紙）',
    // AI写真レシピで作成済みの「ハムと卵の基本チャーハン」（一覧先頭）を開く。
    // ID が動的なためディープリンク直指定ではなく一覧からタップで遷移する。
    actions: [
      { tapNorm: [0.262, 0.295], atMs: 800 }, // 一覧先頭カード
      { swipeNorm: [0.5, 0.7, 0.5, 0.5], atMs: 3000 }, // 材料を少し見せる
    ],
  },
  {
    file: '04-cooking-mode.mp4',
    route: `recipes/${RECIPE_ID}/cook`,
    settleMs: 3500, // エミュ長時間稼働でコールドスタートが遅くなることがある

    durationMs: 3500,
    label: '料理中モード',
    // 手順送りは「次へ」ボタンをタップ（画面中央のスワイプ/タップは材料シートが開く）
    actions: [
      { tapNorm: [0.66, 0.896], atMs: 1000 }, // 次へ →
      { tapNorm: [0.66, 0.896], atMs: 2300 }, // さらに次へ
    ],
  },
  {
    file: '05-recipe-library.mp4',
    route: 'recipes',
    settleMs: 2200,
    durationMs: 3200,
    label: 'レシピ蔵書庫（一覧・検索）',
    // 6件のシードデータは1画面に収まりスクロールできないため、フィルタタブの
    // 切替（一覧が絞り込まれる視覚変化）で動きを作る。
    actions: [
      { tapNorm: [0.257, 0.157], atMs: 800 }, // 「肉」タブ
      { tapNorm: [0.117, 0.157], atMs: 1900 }, // 「すべて」タブに戻す
    ],
  },
  {
    file: '06-shopping-pantry.mp4',
    route: 'shopping',
    settleMs: 3000, // 8件のDBクエリ描画がロードスピナーを挟むため長めに待つ
    durationMs: 3200,
    label: '買い物リスト',
    // 8件では1画面に収まりスクロールしないため、チェック操作で動きを作る
    actions: [
      { tapNorm: [0.078, 0.217], atMs: 800 }, // 先頭項目をチェック
      { tapNorm: [0.078, 0.217], atMs: 2200 }, // 元に戻す
    ],
  },
];

const adbPath = resolveAdb();
const serial = args.serial ?? autoSelectSerial();
const outDir = args.out ? path.resolve(args.out) : DEFAULT_OUT;
fs.mkdirSync(outDir, { recursive: true });

console.log(`device: ${serial}`);
ensureAppInstalled();

const selected = SCENES.filter(
  (s) => !args.scenes || args.scenes.some((prefix) => s.file.startsWith(prefix)),
);

async function main() {
  enterDemoMode();
  sleep(3000);
  dismissAnrIfPresent();

  const results = [];
  try {
    for (const scene of selected) {
      results.push(await recordScene(scene));
    }
  } finally {
    exitDemoMode();
  }

  console.log('\n=== summary ===');
  for (const r of results) {
    console.log(`${r.status.padEnd(10)} ${r.file}  ${r.size ?? ''}`);
  }
  const failed = results.filter((r) => r.status === 'FAILED');
  process.exit(failed.length ? 1 : 0);
}

// ─── record ──────────────────────────────────────────────────────────────────

/**
 * 端末の画面サイズ（wm size）を正規化座標 → 実座標の変換に使う。1回だけ取得しキャッシュ。
 */
let cachedScreenSize;
function getScreenSize() {
  if (cachedScreenSize) return cachedScreenSize;
  const res = adb(['shell', 'wm', 'size']);
  const m = /(\d+)x(\d+)/.exec(res.output);
  cachedScreenSize = { w: m ? Number(m[1]) : 1080, h: m ? Number(m[2]) : 2400 };
  return cachedScreenSize;
}

async function recordScene(scene) {
  const url = `${SCHEME}://${scene.route}`;
  adb(['shell', 'am', 'force-stop', PACKAGE]);
  const start = adb([
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    url,
    PACKAGE,
  ]);
  if (!start.ok) {
    console.error(`FAILED to open ${url}: ${start.output.slice(0, 200)}`);
    return { ...scene, status: 'FAILED' };
  }
  await asyncSleep(scene.settleMs);
  dismissAnrIfPresent();

  const devicePath = `/sdcard/promo-${scene.file}`;
  adb(['shell', 'rm', '-f', devicePath]);

  // screenrecord は静止画面だとフレームを1枚しか出さないため、バックグラウンドで
  // 開始した状態のまま演出タップ/スワイプを注入してから --time-limit の終了を待つ。
  const recProc = spawn(
    adbPath,
    [
      '-s',
      serial,
      'shell',
      'screenrecord',
      '--size',
      '1080x2400',
      '--bit-rate',
      '8000000',
      '--time-limit',
      String(Math.ceil(scene.durationMs / 1000)),
      devicePath,
    ],
    { stdio: 'ignore' },
  );
  const recDone = new Promise((resolve) => {
    recProc.on('close', resolve);
    recProc.on('error', resolve);
  });

  for (const action of scene.actions ?? []) {
    await asyncSleep(action.atMs ?? 500);
    performAction(action);
  }

  await Promise.race([recDone, asyncSleep(scene.durationMs + 6000)]);
  if (recProc.exitCode === null) recProc.kill('SIGINT'); // 保険（time-limit 到達で通常は自然終了）
  await asyncSleep(500); // ファイルフラッシュ待ち

  const pull = spawnSync(
    adbPath,
    ['-s', serial, 'pull', devicePath, path.join(outDir, scene.file)],
    {
      encoding: 'utf8',
    },
  );
  adb(['shell', 'rm', '-f', devicePath]);

  const localPath = path.join(outDir, scene.file);
  // 遷移がハードカットの画面（料理中モード等）はフレーム数が少なくファイルが小さい。
  // 10KB 未満のみ失敗扱い（duration>0 かは ffprobe で別途確認する運用）。
  if (pull.status !== 0 || !fs.existsSync(localPath) || fs.statSync(localPath).size < 10_000) {
    console.error(`FAILED pull for ${scene.file}: ${pull.stderr}`);
    return { ...scene, status: 'FAILED' };
  }
  const size = `${Math.round(fs.statSync(localPath).size / 1024)}KB`;
  console.log(`recorded: ${scene.file} (${size}) — ${scene.label}`);
  return { ...scene, status: 'recorded', size };
}

function performAction(action) {
  const { w, h } = getScreenSize();
  if (action.tapNorm) {
    const [nx, ny] = action.tapNorm;
    adb(['shell', 'input', 'tap', String(Math.round(nx * w)), String(Math.round(ny * h))]);
  } else if (action.swipeNorm) {
    const [nx1, ny1, nx2, ny2] = action.swipeNorm;
    adb([
      'shell',
      'input',
      'swipe',
      String(Math.round(nx1 * w)),
      String(Math.round(ny1 * h)),
      String(Math.round(nx2 * w)),
      String(Math.round(ny2 * h)),
      '350',
    ]);
  }
}

function asyncSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * wipe-data 直後の重いエミュレータではデモモードのブロードキャストで SystemUI が
 * ANR ダイアログを出すことがある。dumpsys で検出し「Wait」をタップして閉じる。
 */
function dismissAnrIfPresent() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const win = adb(['shell', 'dumpsys', 'window', 'windows']);
    if (!/Application Not Responding/.test(win.output)) return;
    if (attempt === 0) console.log('ANR dialog detected — dismissing (Wait)');
    const size = adb(['shell', 'wm', 'size']);
    const m = /(\d+)x(\d+)/.exec(size.output);
    const w = m ? Number(m[1]) : 1080;
    const h = m ? Number(m[2]) : 2400;
    adb(['shell', 'input', 'tap', String(Math.round(w * 0.3)), String(Math.round(h * 0.57))]);
    sleep(3000);
  }
  console.warn('WARN: ANR dialog may still be visible');
}

// ─── status bar demo mode ────────────────────────────────────────────────────

function enterDemoMode() {
  adb(['shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1']);
  demo(['-e', 'command', 'enter']);
  demo(['-e', 'command', 'clock', '-e', 'hhmm', '0900']);
  demo(['-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false']);
  demo([
    '-e',
    'command',
    'network',
    '-e',
    'wifi',
    'show',
    '-e',
    'level',
    '4',
    '-e',
    'fully',
    'true',
  ]);
  demo(['-e', 'command', 'network', '-e', 'mobile', 'hide']);
  demo(['-e', 'command', 'notifications', '-e', 'visible', 'false']);
}

function exitDemoMode() {
  demo(['-e', 'command', 'exit']);
}

function demo(extras) {
  adb(['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', ...extras]);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function adb(argv) {
  const res = spawnSync(adbPath, ['-s', serial, ...argv], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function resolveAdb() {
  const sdk =
    process.env.ANDROID_HOME ?? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  const exe = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  if (!fs.existsSync(exe)) throw new Error(`adb not found: ${exe}`);
  return exe;
}

function autoSelectSerial() {
  const res = spawnSync(adbPath, ['devices'], { encoding: 'utf8' });
  const devices = (res.stdout ?? '')
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('device'))
    .map((l) => l.split(/\s+/)[0]);
  if (devices.length !== 1) {
    throw new Error(
      devices.length === 0
        ? 'デバイスが接続されていません（エミュレータ起動 or USB 接続）'
        : `複数デバイス接続中: ${devices.join(', ')} — --serial で指定してください`,
    );
  }
  return devices[0];
}

function ensureAppInstalled() {
  const res = adb(['shell', 'pm', 'path', PACKAGE]);
  if (!res.ok || !res.output.includes('package:')) {
    throw new Error(
      `${PACKAGE} が未インストールです。サンプルデータ入りビルドを install -r してください`,
    );
  }
}

function sleep(ms) {
  spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${ms})`]);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--serial') parsed.serial = argv[++i];
    else if (t === '--out') parsed.out = argv[++i];
    else if (t === '--recipe') parsed.recipe = argv[++i];
    else if (t === '--scenes') parsed.scenes = argv[++i].split(',').map((s) => s.trim());
  }
  return parsed;
}

await main();
