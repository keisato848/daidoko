/**
 * record-promo-video.mjs が収録した各シーンの mp4 を、YouTube 公開用の
 * 1本のプロモーション動画に結合する（ffmpeg 使用・要インストール）。
 *
 * 仕組み:
 *   1. 各シーンをトリミング・フェード処理
 *   2. オープニングのタイトルカード（アプリ名・推し機能のコピー）を生成して先頭に結合
 *   3. concat demuxer で結合し、YouTube 推奨設定（H.264/AAC・yuv420p）で書き出す
 *
 * 使い方:
 *   node scripts/release/edit-promo-video.mjs [--in <dir>] [--out <file>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const IN_DIR = args.in ? path.resolve(args.in) : path.join(ROOT, 'Temp/promo-video-raw');
const WORK_DIR = path.join(IN_DIR, '_edit');
const OUT_FILE = args.out
  ? path.resolve(args.out)
  : path.join(ROOT, 'Temp/promo-video/daidoko-promo.mp4');

const FADE_MS = 350;

/** シーン順・トリム尺・字幕。record-promo-video.mjs の SCENES と対応。 */
// seconds は record-promo-video.mjs の実収録尺（screenrecord は画面更新時のみ
// フレームを出すため、静定後の実尺は演出アクションの動きで決まる。要再収録時は
// ffprobe -show_entries stream=duration で実測してから合わせること）。
const CUTS = [
  { file: '01-home.mp4', seconds: 1.25, caption: '家族の台所を、ひとつの手帳に' },
  { file: '02-photo-to-recipe-intro.mp4', seconds: 1.85, caption: '写真を撮るだけで' },
  { file: '03-recipe-detail-photo.mp4', seconds: 1.7, caption: 'AIがレシピを下書き' },
  { file: '04-cooking-mode.mp4', seconds: 3.0, caption: '料理中は次の一手だけ' },
  { file: '05-recipe-library.mp4', seconds: 2.4, caption: 'いつでもすぐ検索' },
  { file: '06-shopping-pantry.mp4', seconds: 1.75, caption: '買い物・在庫までひとつに' },
];

const ffmpeg = resolveFfmpeg();

function main() {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  console.log(`ffmpeg: ${ffmpeg}`);
  for (const cut of CUTS) {
    const src = path.join(IN_DIR, cut.file);
    if (!fs.existsSync(src))
      throw new Error(`missing scene: ${src}（先に record-promo-video.mjs を実行）`);
  }

  // 1) タイトルカード（1.6秒・静止画からの生成）
  const titleCardPath = path.join(WORK_DIR, '00-title.mp4');
  buildTitleCard(titleCardPath);

  // 2) 各シーンをトリム＋字幕焼き込み＋フェード
  const processed = [titleCardPath];
  for (const [index, cut] of CUTS.entries()) {
    const src = path.join(IN_DIR, cut.file);
    const dst = path.join(WORK_DIR, `cut-${String(index).padStart(2, '0')}.mp4`);
    processScene(src, dst, cut);
    processed.push(dst);
  }

  // 3) concat
  const listPath = path.join(WORK_DIR, 'concat-list.txt');
  fs.writeFileSync(
    listPath,
    processed.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8',
  );
  run([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-r',
    '30',
    '-movflags',
    '+faststart',
    '-an',
    OUT_FILE,
  ]);

  const bytes = fs.statSync(OUT_FILE).size;
  console.log(`\nOK: ${OUT_FILE} (${Math.round(bytes / 1024 / 1024)}MB)`);
  console.log(
    'YouTube へのアップロードは手動でお願いします（公開範囲: 一般公開 or 限定公開・広告オフ・年齢制限なし）。',
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function processScene(src, dst, cut) {
  const fadeOutStart = Math.max(cut.seconds - FADE_MS / 1000, 0);
  const drawtext = buildDrawtext(cut.caption);
  const vf = [
    `trim=0:${cut.seconds}`,
    'setpts=PTS-STARTPTS',
    'fps=30', // 実機収録は静止区間でフレームが疎になるため、CFR に揃えて concat 時の PTS 破綻を防ぐ
    `fade=t=in:st=0:d=${FADE_MS / 1000}`,
    `fade=t=out:st=${fadeOutStart}:d=${FADE_MS / 1000}`,
    drawtext,
  ].join(',');
  run([
    '-y',
    '-i',
    src,
    '-vf',
    vf,
    '-an',
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-r',
    '30',
    dst,
  ]);
}

function buildDrawtext(caption) {
  const escaped = caption.replace(/:/g, '\\:').replace(/'/g, "\\'");
  const fontfile = resolveJapaneseFont();
  const fontOpt = fontfile
    ? `fontfile='${fontfile.replace(/\\/g, '/').replace(/:/g, '\\:')}':`
    : '';
  return (
    `drawtext=${fontOpt}text='${escaped}':fontcolor=0xDCC9A8:fontsize=54:` +
    `box=1:boxcolor=0x0A0805@0.85:boxborderw=24:x=(w-text_w)/2:y=h-480`
  );
}

function buildTitleCard(outPath) {
  const fontfile = resolveJapaneseFont();
  const fontOpt = fontfile
    ? `fontfile='${fontfile.replace(/\\/g, '/').replace(/:/g, '\\:')}':`
    : '';
  const title = 'だいどこ';
  const sub = '写真を撮るだけで、レシピが完成。';
  const vf = [
    `drawtext=${fontOpt}text='${title}':fontcolor=0xDCC9A8:fontsize=140:x=(w-text_w)/2:y=(h-text_h)/2-60`,
    `drawtext=${fontOpt}text='${sub}':fontcolor=0xC9A16A:fontsize=48:x=(w-text_w)/2:y=(h/2)+120`,
  ].join(',');
  run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x0A0805:s=1080x2400:d=1.6',
    '-vf',
    `${vf},fade=t=in:st=0:d=0.3,fade=t=out:st=1.3:d=0.3`,
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-r',
    '30',
    outPath,
  ]);
}

let cachedFont;
function resolveJapaneseFont() {
  if (cachedFont !== undefined) return cachedFont;
  const candidates = [
    'C:/Windows/Fonts/YuGothM.ttc',
    'C:/Windows/Fonts/yugothic.ttf',
    'C:/Windows/Fonts/meiryo.ttc',
    'C:/Windows/Fonts/msgothic.ttc',
  ];
  cachedFont = candidates.find((p) => fs.existsSync(p)) ?? null;
  if (!cachedFont)
    console.warn('WARN: 日本語フォントが見つかりません。字幕が文字化けする可能性があります。');
  return cachedFont;
}

function run(ffArgs) {
  const res = spawnSync(ffmpeg, ffArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    console.error(res.stderr?.slice(-3000));
    throw new Error(`ffmpeg failed: ${ffArgs.join(' ')}`);
  }
}

function resolveFfmpeg() {
  const fromPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], {
    encoding: 'utf8',
  });
  const first = fromPath.stdout?.split(/\r?\n/).find(Boolean);
  if (fromPath.status === 0 && first) return first.trim();
  const winget = 'C:/Users/habnk/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe';
  if (fs.existsSync(winget)) return winget;
  throw new Error('ffmpeg not found (winget install --id Gyan.FFmpeg -e)');
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--in') parsed.in = argv[++i];
    else if (t === '--out') parsed.out = argv[++i];
  }
  return parsed;
}

main();
