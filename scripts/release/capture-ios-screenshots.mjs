/**
 * App Store 掲載用スクリーンショットを iOS シミュレータから機械的に取得する（macOS 専用）。
 *
 * 仕組み: 各ショットごとに「アプリを terminate → Expo Router のディープリンク
 * (daidoko://...) で起動 → 待機 → xcrun simctl io screenshot」。
 * ステータスバーは simctl status_bar override で固定（時計 9:41・電池 100%・WiFi/電波フル）。
 * Android 版（capture-store-screenshots.mjs）の iOS 対応版。ANR/SystemUI ダイアログは
 * iOS シミュレータには無いので、そのぶん単純。
 *
 * 前提（macOS + Xcode）:
 *   - Xcode + iOS シミュレータ、Node/pnpm セットアップ済み（docs/リリース手順.md §7・ios-release Skill）
 *   - ストアショット用ビルド（サンプルデータ有効＋コーチマーク無効）をシミュレータに導入済み:
 *       EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
 *         pnpm --filter mobile exec expo run:ios --configuration Release
 *     （または EAS の simulator ビルドを `xcrun simctl install booted <App.app>`）
 *   - スクショ用シミュレータを1台だけ Boot しておく（推奨: iPhone 16 Pro Max = 6.9"/1320x2868）:
 *       xcrun simctl boot "iPhone 16 Pro Max" ; open -a Simulator
 *
 * 使い方:
 *   node scripts/release/capture-ios-screenshots.mjs [--udid <udid>] [--shots 01,02]
 *     [--out <dir>] [--recipe <id>] [--keep-status-bar] [--wait <ms>]
 *
 * manual 指定のショット（AI 実行結果など自動遷移できない画面）はスキップし、
 * 既存ファイルを維持する。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUT = path.join(ROOT, 'docs/store/app-store/phone-screenshots');
const BUNDLE_ID = 'com.daidoko.app';
const SCHEME = 'daidoko';

if (process.platform !== 'darwin') {
  console.error('このスクリプトは macOS 専用です（xcrun simctl を使用）。Mac で実行してください。');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const RECIPE_ID = args.recipe ?? 'recipe-1';

/**
 * ショット定義。route は Expo Router のパス（daidoko://<route> で開く）。
 * Android 版（capture-store-screenshots.mjs）と同じ画面構成・同じ順序に揃える。
 * manual: true は自動化不可（既存ファイル維持）。
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

const udid = args.udid ?? autoSelectBootedUdid();
const outDir = args.out ? path.resolve(args.out) : DEFAULT_OUT;
fs.mkdirSync(outDir, { recursive: true });

console.log(`simulator: ${udid}`);
ensureAppInstalled();

const selected = SHOTS.filter(
  (s) => !args.shots || args.shots.some((prefix) => s.file.startsWith(prefix)),
);

if (!args.keepStatusBar) overrideStatusBar();
const results = [];
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
  if (!args.keepStatusBar) clearStatusBar();
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
  // 一度終了してからディープリンクで開くと、確実に対象画面へ遷移できる。
  simctl(['terminate', udid, BUNDLE_ID]); // 未起動でも無害（失敗は無視）
  const open = simctl(['openurl', udid, url]);
  if (!open.ok) {
    console.error(`FAILED to open ${url}: ${open.output.slice(0, 200)}`);
    results.push({ ...shot, status: 'FAILED' });
    return;
  }
  sleep(args.waitMs); // コールドスタート＋データ読込＋アニメーション静定

  const dest = path.join(outDir, shot.file);
  const cap = simctl(['io', udid, 'screenshot', '--type=png', dest]);
  if (!cap.ok || !fs.existsSync(dest)) {
    console.error(`FAILED screenshot for ${shot.file}: ${cap.output.slice(0, 200)}`);
    results.push({ ...shot, status: 'FAILED' });
    return;
  }
  const buf = fs.readFileSync(dest);
  if (buf.length < 1000 || buf.readUInt32BE(0) !== 0x89504e47) {
    console.error(`FAILED (not a PNG) for ${shot.file}`);
    results.push({ ...shot, status: 'FAILED' });
    return;
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const size = `${w}x${h} ${Math.round(buf.length / 1024)}KB`;
  console.log(`captured: ${shot.file} (${size}) — ${shot.label}`);
  results.push({ ...shot, status: 'captured', size });
}

// ─── status bar override ─────────────────────────────────────────────────────

function overrideStatusBar() {
  // Apple 慣習の 9:41・電池満充電・電波/WiFi フルに固定する。
  simctl([
    'status_bar',
    udid,
    'override',
    '--time',
    '9:41',
    '--batteryState',
    'charged',
    '--batteryLevel',
    '100',
    '--wifiBars',
    '3',
    '--cellularBars',
    '4',
    '--dataNetwork',
    'wifi',
  ]);
}

function clearStatusBar() {
  simctl(['status_bar', udid, 'clear']);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function simctl(argv) {
  const res = spawnSync('xcrun', ['simctl', ...argv], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function autoSelectBootedUdid() {
  const res = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`xcrun simctl list に失敗: ${res.stderr ?? ''}`);
  let data;
  try {
    data = JSON.parse(res.stdout ?? '{}');
  } catch {
    throw new Error('simctl list の JSON 解析に失敗しました');
  }
  const booted = Object.values(data.devices ?? {})
    .flat()
    .filter((d) => d && d.state === 'Booted');
  if (booted.length !== 1) {
    throw new Error(
      booted.length === 0
        ? 'Boot 中のシミュレータがありません（例: xcrun simctl boot "iPhone 16 Pro Max"）'
        : `複数のシミュレータが Boot 中: ${booted.map((d) => d.udid).join(', ')} — --udid で指定してください`,
    );
  }
  return booted[0].udid;
}

function ensureAppInstalled() {
  const res = simctl(['get_app_container', udid, BUNDLE_ID]);
  if (!res.ok) {
    throw new Error(
      `${BUNDLE_ID} がシミュレータに未インストールです。サンプルデータ入りビルドを ` +
        `expo run:ios（Release）または xcrun simctl install で導入してください`,
    );
  }
}

function sleep(ms) {
  spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${ms})`]);
}

function parseArgs(argv) {
  const parsed = { waitMs: 6000, keepStatusBar: false };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--udid') parsed.udid = argv[++i];
    else if (t === '--out') parsed.out = argv[++i];
    else if (t === '--recipe') parsed.recipe = argv[++i];
    else if (t === '--shots') parsed.shots = argv[++i].split(',').map((s) => s.trim());
    else if (t === '--wait') parsed.waitMs = Number(argv[++i]);
    else if (t === '--keep-status-bar') parsed.keepStatusBar = true;
  }
  return parsed;
}
