/**
 * Google Play ストア掲載用スクリーンショットを接続中の端末/エミュレータから機械的に取得する。
 *
 * 仕組み: 各ショットごとに「アプリを force-stop → Expo Router のディープリンク
 * (daidoko://...) でコールドスタート → 待機 → adb exec-out screencap」。
 * ステータスバーは SystemUI デモモードで固定（時計 09:00・電池 100%・通知なし）。
 *
 * 前提:
 *   - ストアショット用リリース APK（サンプルデータ有効＋コーチマーク無効）がインストール済みであること:
 *       EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
 *         node scripts/agent/build-android.mjs --arch x86_64
 *       adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
 *   - 推奨エミュレータ: daidoko_e2e_fresh_api36（1080x2400 = 既存ストア掲載と同解像度）
 *   - wipe-data 直後の初回ブートは SystemUI が重く ANR ダイアログが写り込むことがある。
 *     起動後 2〜3 分待ってから実行する（出たら Wait で閉じて再実行）
 *
 * 使い方:
 *   node scripts/release/capture-store-screenshots.mjs [--serial <serial>] [--shots 01,02]
 *     [--out <dir>] [--recipe <id>] [--keep-status-bar] [--locale en-US]
 *     [--keep-cooking-session]
 *
 * --locale はアプリ単位の言語（Android 13+ の per-app language）を一時的に切り替えてから
 * 撮る。終了時に必ず端末既定へ戻す。英語掲載用は
 *   --locale en-US --out docs/store/google-play/phone-screenshots-en
 *
 * manual 指定のショット（AI 実行結果など自動遷移できない画面）はスキップし、
 * 既存ファイルを維持する。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUT = path.join(ROOT, 'docs/store/google-play/phone-screenshots');
const PACKAGE = 'com.daidoko.app';
const SCHEME = 'daidoko';
const DB_PATH = `/data/data/${PACKAGE}/files/SQLite/daidoko.db`;

const args = parseArgs(process.argv.slice(2));
const RECIPE_ID = args.recipe ?? 'recipe-1';

/**
 * ショット定義。route は Expo Router のパス（daidoko://<route> で開く）。
 * manual: true は自動化不可（既存ファイル維持）。順序 = Play 表示順（README.md と一致させる）。
 */
const SHOTS = [
  { file: '01-home-timeline.png', route: '', label: 'ホーム（調理タイムライン）' },
  { file: '02-recipe-library.png', route: 'recipes', label: 'レシピ蔵書庫' },
  { file: '03-recipe-detail.png', route: `recipes/${RECIPE_ID}`, label: 'レシピ詳細' },
  { file: '04-cooking-mode.png', route: `recipes/${RECIPE_ID}/cook`, label: '料理中モード' },
  { file: '06-family-group.png', route: 'family', label: '家族グループ' },
  {
    file: '07-photo-to-recipe.png',
    route: 'recipes/import-photo',
    label: '写真からレシピ（導線）',
  },
  { file: '08-photo-recipe-result.png', manual: true, label: 'AI 結果画面（手動撮影・既存維持）' },
  {
    file: '10-recipe-detail-photo.png',
    manual: true,
    label: '写真つき詳細（実データ依存・既存維持）',
  },
];

const adbPath = resolveAdb();
const serial = args.serial ?? autoSelectSerial();
const outDir = args.out ? path.resolve(args.out) : DEFAULT_OUT;
fs.mkdirSync(outDir, { recursive: true });

console.log(`device: ${serial}`);
ensureAppInstalled();
if (args.locale) applyAppLocale(args.locale);

const selected = SHOTS.filter(
  (s) => !args.shots || args.shots.some((prefix) => s.file.startsWith(prefix)),
);

if (!args.keepStatusBar) {
  enterDemoMode();
  sleep(3000); // デモモード反映待ち（ここで SystemUI が ANR することがある）
  dismissAnrIfPresent();
}
const results = [];
/** 直前に開いたのが cook 画面か（run の最後が 04 だとセッションが残るため、finally で消す用） */
let lastShotOpenedCook = false;
try {
  for (const shot of selected) {
    if (shot.manual) {
      console.log(`SKIP (manual): ${shot.file} — ${shot.label}`);
      results.push({ ...shot, status: 'manual-skip' });
      continue;
    }
    captureShot(shot);
  }
} finally {
  if (!args.keepStatusBar) exitDemoMode();
  if (args.locale) applyAppLocale(''); // 端末既定に戻す（撮り忘れの言語汚染を残さない）
  if (lastShotOpenedCook && !args.keepCookingSession) {
    // --shots 04 のように cook 画面で撮影を終えるとセッションだけが残り、
    // この後に人手で撮る 08/10 に Now Cooking pill が写り込む。
    // 次のショットが無い＝captureShot 冒頭のガードはもう走らないため、ここで消す
    adb(['shell', 'am', 'force-stop', PACKAGE]);
    clearCookingSession();
  }
}

console.log('\n=== summary ===');
for (const r of results) {
  console.log(`${r.status.padEnd(12)} ${r.file}  ${r.size ?? ''}`);
}
const failed = results.filter((r) => r.status === 'FAILED');
process.exit(failed.length ? 1 : 0);

// ─── capture ─────────────────────────────────────────────────────────────────

function captureShot(shot) {
  const url = `${SCHEME}://${shot.route}`;
  adb(['shell', 'am', 'force-stop', PACKAGE]);
  clearCookingSession();
  lastShotOpenedCook = false;
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
    results.push({ ...shot, status: 'FAILED' });
    return;
  }
  // 起動に成功した時点でセッションは始まっている（screencap の成否とは無関係）
  lastShotOpenedCook = shot.route.endsWith('/cook');
  sleep(args.waitMs); // コールドスタート＋データ読込＋アニメーション静定
  dismissAnrIfPresent();

  const cap = spawnSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const png = cap.stdout;
  if (cap.status !== 0 || !png || png.length < 1000 || png.readUInt32BE(0) !== 0x89504e47) {
    console.error(`FAILED screencap for ${shot.file}`);
    results.push({ ...shot, status: 'FAILED' });
    return;
  }
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  fs.writeFileSync(path.join(outDir, shot.file), png);
  const size = `${w}x${h} ${Math.round(png.length / 1024)}KB`;
  console.log(`captured: ${shot.file} (${size}) — ${shot.label}`);
  results.push({ ...shot, status: 'captured', size });
}

// ─── cooking session guard ───────────────────────────────────────────────────

/**
 * 調理セッション汚染ガード（PR #254 で必要になった）。
 *
 * PR #254 の「調理セッション」: 料理中モード（recipes/{id}/cook）を開くと
 * cooking-session.store.ts がセッションを開始し、app_meta テーブルの
 * `cooking_session` キーに永続化する。セッション中は**タブバー直上に
 * Now Cooking pill**・ホームに復帰カードが出て、「完成」でだけ消える。
 *
 * このスクリプトは 04-cooking-mode で cook 画面をディープリンクで開くため
 * セッションが始まり、その後に撮る 06-family-group や手動の 10 に pill が
 * 写り込む（07 はタブバーを隠す画面なので写らない）。force-stop しても
 * セッションは app_meta に残っていて次回起動で復元されるため、DB 側で消す。
 *
 * 消すタイミングは 2 箇所: 各ショットの起動前（前のショットが残した分）と、
 * run の終了時（--shots 04 のように cook 画面で撮り終えると起動前ガードが
 * もう走らず、後で人手で撮る 08/10 に pill が残るため）。
 *
 * 消し方は store の persist(null) と同じ「空文字を書く」（loadCookingSession は
 * 空文字なら復元しない）。adb root が効く端末（エミュレータ）のみ実行でき、
 * root が取れない実機では警告を 1 度だけ出して続行する — 撮影順の工夫
 * （04 を最後に撮る／撮影後にアプリで「完成」を押す）で回避できるため、
 * 失敗で撮影は止めない。
 *
 * pill をあえて見せたいショットを作る日が来たら、--keep-cooking-session で
 * このガードをオプトアウトできる。
 */

/** root の可否は最初の 1 回だけ判定して覚える（毎ショット adb root し直さない） */
let sessionGuardUsable = null; // null = 未判定 / true = 消せる / false = 諦めた（警告済み）

function clearCookingSession() {
  if (args.keepCookingSession) return;
  if (sessionGuardUsable === null) sessionGuardUsable = tryAdbRoot();
  if (!sessionGuardUsable) return;
  const res = adb([
    'shell',
    `sqlite3 ${DB_PATH} "UPDATE app_meta SET value='' WHERE key='cooking_session';"`,
  ]);
  if (!res.ok) {
    // sqlite3 が無い・DB 未作成など。撮影は止めず、警告の繰り返しもしない
    console.warn(`WARN: 調理セッションの削除に失敗（続行）: ${res.output.slice(0, 200)}`);
    sessionGuardUsable = false;
  }
}

function tryAdbRoot() {
  const res = spawnSync(adbPath, ['-s', serial, 'root'], { encoding: 'utf8' });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.status !== 0 || /cannot run as root/i.test(out)) {
    console.warn(
      'WARN: adb root が使えない端末（実機）のため調理セッションを消せません。' +
        '04-cooking-mode の後に撮るショットのタブバー直上に Now Cooking pill が' +
        '写り込みえます。04 を最後に撮る／撮影後にアプリで「完成」を押す、で回避してください',
    );
    return false;
  }
  // adb root は adbd を再起動する。直後の shell が落ちないよう復帰を待つ
  spawnSync(adbPath, ['-s', serial, 'wait-for-device']);
  return true;
}

// ─── ANR dialog ──────────────────────────────────────────────────────────────

/**
 * wipe-data 直後の重いエミュレータではデモモードのブロードキャストで SystemUI が
 * ANR ダイアログを出し、スクショに写り込む。dumpsys でダイアログを検出し、
 * 「Wait」（実測で画面の x≈30% / y≈57% 位置）をタップして閉じる。
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

// ─── per-app language（Android 13+） ─────────────────────────────────────────

/**
 * アプリ単位の言語を切り替える。空文字で端末既定に戻す。
 * 端末全体のロケールを変えないので、他アプリや端末設定を汚さない。
 */
function applyAppLocale(tag) {
  const res = adb(['shell', 'cmd', 'locale', 'set-app-locales', PACKAGE, '--locales', tag]);
  if (!res.ok) {
    throw new Error(
      `アプリ言語の切り替えに失敗（Android 13+ が必要）: ${res.output.slice(0, 200)}`,
    );
  }
  console.log(tag ? `app locale: ${tag}` : 'app locale: (端末既定に戻した)');
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
  const parsed = { waitMs: 7000, keepStatusBar: false, keepCookingSession: false };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--serial') parsed.serial = argv[++i];
    else if (t === '--out') parsed.out = argv[++i];
    else if (t === '--recipe') parsed.recipe = argv[++i];
    else if (t === '--shots') parsed.shots = argv[++i].split(',').map((s) => s.trim());
    else if (t === '--locale') parsed.locale = argv[++i];
    else if (t === '--wait') parsed.waitMs = Number(argv[++i]);
    else if (t === '--keep-status-bar') parsed.keepStatusBar = true;
    else if (t === '--keep-cooking-session') parsed.keepCookingSession = true;
  }
  return parsed;
}
