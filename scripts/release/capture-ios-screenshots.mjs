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
 *     [--out <dir>] [--recipe <id>] [--photo-recipe <id>] [--keep-status-bar] [--wait <ms>]
 *     [--keep-cooking-session]
 *
 * manual 指定のショット（AI 実行結果など自動遷移できない画面）はスキップし、
 * 既存ファイルを維持する。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
/** 表紙写真つきレシピ（seed 同梱の scrambled-egg.jpg が付く） */
const PHOTO_RECIPE_ID = args.photoRecipe ?? 'recipe-7';

/**
 * ショット定義。route は Expo Router のパス（daidoko://<route> で開く）。
 * 掲載 8 枚と表示順の正は update-appstore-screenshots.mjs の ORDER
 * （Play 版 update-play-screenshots.mjs と同構成・1.13.1）。撮影手順の詳細は
 * docs/store/app-store/phone-screenshots/SHOOTING-1.13.1.md。
 * manual: true は自動化不可（既存ファイル維持）。
 * extra: true は extras/ 退避済みの旧ショット — 既定では撮らず、
 * `--shots 03` のように明示したときだけ撮る。
 */
const SHOTS = [
  { file: '01-home-timeline.png', route: '', label: 'ホーム（調理タイムライン）' },
  { file: '02-recipe-library.png', route: 'recipes', label: 'レシピ蔵書庫' },
  {
    // 1.13.0 で掲載 8 枚から外れた（10 と内容が重複気味）。再取得用に残す。
    file: '03-recipe-detail.png',
    route: `recipes/${RECIPE_ID}`,
    label: 'レシピ詳細（extras・明示指定時のみ）',
    extra: true,
  },
  {
    // 1.13.1 で掲載 8 枚から外れた。cook 画面を開くと調理セッションが始まり、
    // 以後のショットに Now Cooking pill が写り込むため、各ショット前の
    // clearCookingSession() と run 終了時の後始末が面倒を見る。
    file: '04-cooking-mode.png',
    route: `recipes/${RECIPE_ID}/cook`,
    label: '料理中モード（extras・明示指定時のみ）',
    extra: true,
  },
  {
    // 事前に献立を組んで menu_plans に保存しておくこと（SHOOTING-1.13.1.md）。
    // 組んだ献立は terminate してもコールドスタートで復元されるので自動で撮れる。
    file: '05-menu-plan.png',
    route: 'menu',
    label: '献立（組んだ状態・時間帯チップ・1.13.1）',
  },
  { file: '06-family-group.png', route: 'family', label: '家族グループ' },
  {
    // BYOK キーが残っていると無料枠の説明が「自分のAIキー・使い放題」に化ける。
    // キーを消してから撮る（SHOOTING-1.13.1.md の撮影順）。
    file: '07-photo-to-recipe.png',
    route: 'recipes/import-photo',
    label: '写真からレシピ（導線）',
  },
  { file: '08-photo-recipe-result.png', manual: true, label: 'AI 結果画面（手動撮影）' },
  {
    // recipe-7（ふわとろスクランブルエッグトースト）は seedBundledCoverPhotos が
    // assets/seed-photos/scrambled-egg.jpg を表紙に設定するので、実データ無しで再現できる。
    file: '10-recipe-detail-photo.png',
    route: `recipes/${PHOTO_RECIPE_ID}`,
    label: '写真つき詳細（recipe-7・表紙は seed 同梱）',
  },
  {
    file: '12-fridge-to-recipe.png',
    manual: true,
    label: '冷蔵庫の確認シート（AI 実行が要る・手動撮影・1.13.1）',
  },
];

const udid = args.udid ?? autoSelectBootedUdid();
const outDir = args.out ? path.resolve(args.out) : DEFAULT_OUT;
fs.mkdirSync(outDir, { recursive: true });

console.log(`simulator: ${udid}`);
ensureAppInstalled();

const selected = SHOTS.filter((s) =>
  args.shots ? args.shots.some((prefix) => s.file.startsWith(prefix)) : !s.extra,
);

if (!args.keepStatusBar) overrideStatusBar();
const results = [];
/** 撮影済みの画像ハッシュ → ファイル名。同一画像の二度撮り（＝遷移失敗）を検出する。 */
const capturedDigests = new Map();
/** 直前に開いたのが cook 画面か（run の最後が 04 だとセッションが残るため、finally で消す用） */
let lastShotOpenedCook = false;
/** 調理セッション削除の失敗警告は 1 度だけ出す */
let sessionGuardWarned = false;
/** get_app_container の結果キャッシュ（毎ショット呼ばない） */
let appDataDir = null;
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
  if (lastShotOpenedCook && !args.keepCookingSession) {
    // --shots 04 のように cook 画面で撮り終えるとセッションだけが残り、この後に
    // 手で撮る 08/12 に Now Cooking pill が写り込む。次のショットが無い＝
    // captureShot 冒頭のガードはもう走らないため、ここで消す
    simctl(['terminate', udid, BUNDLE_ID]);
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
  // 一度終了してからディープリンクで開くと、確実に対象画面へ遷移できる。
  simctl(['terminate', udid, BUNDLE_ID]); // 未起動でも無害（失敗は無視）
  clearCookingSession(); // 前のショット（cook 画面）が残したセッションを起動前に消す
  const open = simctl(['openurl', udid, url]);
  if (!open.ok) {
    console.error(`FAILED to open ${url}: ${open.output.slice(0, 200)}`);
    results.push({ ...shot, status: 'FAILED' });
    return;
  }
  lastShotOpenedCook = shot.route.endsWith('/cook');
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

  // 画面が遷移していないと、どのショットも同じ絵（ホーム画面など）になる。
  // PNG として妥当なだけでは "撮れた" と言えないので、既出の絵と一致したら失敗にする。
  // 実際に踏んだ罠: iOS は daidoko:// を simctl openurl で開くと
  // 「"だいどこ" で開きますか?」の確認ダイアログを挟む。放置すると遷移せず、
  // 全ショットがホーム画面＋ダイアログの同一画像になる（2026-08-13）。
  const digest = crypto.createHash('sha256').update(buf).digest('hex');
  const duplicateOf = capturedDigests.get(digest);
  if (duplicateOf) {
    console.error(
      `FAILED (${shot.file} が ${duplicateOf} と同一画像): 画面遷移が起きていません。\n` +
        `  シミュレータ画面を確認してください。ディープリンクの確認ダイアログ` +
        `（「"だいどこ" で開きますか?」）が出ていると、この症状になります。`,
    );
    results.push({ ...shot, status: 'FAILED', size });
    return;
  }
  capturedDigests.set(digest, shot.file);

  console.log(`captured: ${shot.file} (${size}) — ${shot.label}`);
  results.push({ ...shot, status: 'captured', size });
}

// ─── cooking session guard ───────────────────────────────────────────────────

/**
 * 調理セッション汚染ガード（Android 版 capture-store-screenshots.mjs の移植・PR #254）。
 *
 * cook 画面（recipes/{id}/cook）を開くと cooking-session.store.ts がセッションを
 * app_meta の `cooking_session` キーへ永続化し、「完成」を押すまでタブバー直上に
 * Now Cooking pill が出続ける（terminate しても次回起動で復元される）。
 * 04 は 1.13.1 で掲載 8 枚から外れたが、`--shots 04` で extras を撮り直した後や
 * 手動検証の残骸が以後のショットへ写り込むのを防ぐため、各ショットの起動前と
 * run 終了時に DB 側で消す。シミュレータの DB は host からそのまま書けるので、
 * adb root が要る Android 版より単純（sqlite3 は macOS 標準搭載）。
 * 空文字は store の persist(null) と同じ表現で、起動時の復元がスキップされる。
 * pill をあえて見せたいショットは --keep-cooking-session でオプトアウト。
 */
function clearCookingSession() {
  if (args.keepCookingSession) return;
  const dataDir = appContainerDataDir();
  if (!dataDir) return;
  const db = path.join(dataDir, 'Documents/SQLite/daidoko.db');
  if (!fs.existsSync(db)) return; // 初回起動前は消すものが無い（諦めず続行）
  const res = spawnSync(
    'sqlite3',
    [db, "UPDATE app_meta SET value='' WHERE key='cooking_session';"],
    { encoding: 'utf8' },
  );
  if (res.status !== 0 && !sessionGuardWarned) {
    // sqlite3 が無い等。撮影は止めず、警告の繰り返しもしない
    console.warn(
      `WARN: 調理セッションの削除に失敗（続行）: ${(res.stderr ?? res.stdout ?? '').slice(0, 200)}`,
    );
    sessionGuardWarned = true;
  }
}

/** アプリの data コンテナパス（get_app_container は毎ショット呼ばずキャッシュする）。 */
function appContainerDataDir() {
  if (appDataDir === null) {
    const res = simctl(['get_app_container', udid, BUNDLE_ID, 'data']);
    appDataDir = res.ok ? res.output.trim() : '';
  }
  return appDataDir;
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
  const parsed = { waitMs: 6000, keepStatusBar: false, keepCookingSession: false };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--udid') parsed.udid = argv[++i];
    else if (t === '--out') parsed.out = argv[++i];
    else if (t === '--recipe') parsed.recipe = argv[++i];
    else if (t === '--photo-recipe') parsed.photoRecipe = argv[++i];
    else if (t === '--shots') parsed.shots = argv[++i].split(',').map((s) => s.trim());
    else if (t === '--wait') parsed.waitMs = Number(argv[++i]);
    else if (t === '--keep-status-bar') parsed.keepStatusBar = true;
    else if (t === '--keep-cooking-session') parsed.keepCookingSession = true;
  }
  return parsed;
}
