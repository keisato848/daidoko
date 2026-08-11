/**
 * Generate Expo app icons from the brand mark.
 * Outputs to apps/mobile/assets/
 *
 * Expo expects:
 *   icon.png            — 1024x1024 (main, square, app launcher)
 *   adaptive-icon.png   — 1024x1024 (Android foreground, with safe area)
 *   splash-icon.png     — 1024x1024 (splash screen, centered logo)
 *   favicon.png         — 48x48 (web)
 *
 * 意匠の変遷:
 * - 〜2026-07: 「臺所」＋欧文副題「DAIDOKO」の落款。
 * - 2026-07-14 (ASO監査 B1): 副題は 48-96px で判読不能だったため、同じ場所に
 *   大きく太い「湯気の立つ椀」と入れ替えた。
 * - 2026-08-10 (多言語対応): **「臺所」自体をやめた。** 落款は縮小すると
 *   読めない字の塊になり、日本語を読まない利用者には料理アプリだと伝わらない
 *   （ユーザー判断: 日本語話者にも分かりづらい）。湯気の立つ椀を主役に据え、
 *   推し機能「写真からレシピ（AI）」を示すきらめきを添えた形にした。
 *   Play のアイコンは言語ごとに分けられないので、これが全世界で唯一の意匠になる。
 */
import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const BG = '#0A0805';
const GOLD = '#C9A16A';
const PAPER = '#DCC9A8';
const OUT = 'apps/mobile/assets';

/**
 * 湯気ひとすじ。base から top へ、左右に振れながら立ちのぼる。
 * 縮小して最初に消えるのがここなので、線は太めにする。
 */
function steam(x, baseY, topY, stroke) {
  const amp = (baseY - topY) * 0.22;
  const m1y = baseY - (baseY - topY) * 0.35;
  const m2y = baseY - (baseY - topY) * 0.72;
  return `<path d="M ${x} ${baseY} C ${x - amp} ${m1y}, ${x + amp} ${m2y}, ${x} ${topY}"
    fill="none" stroke="${PAPER}" stroke-width="${stroke}" stroke-linecap="round"/>`;
}

/**
 * 意匠本体。scale は中心を保ったままの拡縮（adaptive の安全領域・スプラッシュ用）。
 * transparent=true で背景を敷かない（Android の adaptive 前景）。
 */
function buildIconSvg({ size, transparent = false, scale = 1.0 }) {
  const cx = size / 2;
  const cy = size / 2;
  const k = size * scale;

  const bowlY = cy + k * 0.14;
  const bowlW = k * 0.29;
  const bowlDepth = k * 0.32;
  const rim = k * 0.034;
  const stroke = k * 0.033;

  // きらめき = 写真からレシピ（AI）。アプリ内の AI 画面と同じ 4 点星。
  const sx = cx + bowlW * 0.72;
  const sy = cy - k * 0.21;
  const sr = k * 0.13;
  const spark = `<path d="M ${sx} ${sy - sr} Q ${sx + sr * 0.16} ${sy - sr * 0.16}, ${sx + sr} ${sy}
      Q ${sx + sr * 0.16} ${sy + sr * 0.16}, ${sx} ${sy + sr}
      Q ${sx - sr * 0.16} ${sy + sr * 0.16}, ${sx - sr} ${sy}
      Q ${sx - sr * 0.16} ${sy - sr * 0.16}, ${sx} ${sy - sr} Z" fill="${PAPER}"/>`;

  const bgRect = transparent ? '' : `<rect width="${size}" height="${size}" fill="${BG}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  ${bgRect}
  <!-- 湯気（椀より先に描いて、椀の後ろから立つように見せる） -->
  ${steam(cx - bowlW * 0.34, bowlY - k * 0.09, cy - k * 0.24, stroke)}
  ${steam(cx + bowlW * 0.06, bowlY - k * 0.07, cy - k * 0.28, stroke)}
  <!-- きらめき（AI） -->
  ${spark}
  <!-- 椀（塗り。輪郭線だと縮小で潰れる） -->
  <path d="M ${cx - bowlW} ${bowlY} Q ${cx} ${bowlY + bowlDepth}, ${cx + bowlW} ${bowlY} Z" fill="${GOLD}"/>
  <rect x="${cx - bowlW * 1.2}" y="${bowlY - rim}" width="${bowlW * 2.4}" height="${rim * 2}" rx="${rim}" fill="${GOLD}"/>
</svg>`;
}

async function render(svg, outPath, size) {
  const buf = Buffer.from(svg, 'utf8');
  await sharp(buf, { density: 600 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (${size}x${size})`);
}

async function main() {
  if (!existsSync(OUT)) await mkdir(OUT, { recursive: true });

  // 1. Main icon — full canvas, dark bg
  await render(buildIconSvg({ size: 1024 }), `${OUT}/icon.png`, 1024);

  // 2. Adaptive icon foreground — transparent, inner ~66% safe area
  await render(
    buildIconSvg({ size: 1024, transparent: true, scale: 0.62 }),
    `${OUT}/adaptive-icon.png`,
    1024,
  );

  // 3. Splash icon — dark bg, smaller mark
  await render(buildIconSvg({ size: 1024, scale: 0.5 }), `${OUT}/splash-icon.png`, 1024);

  // 4. Favicon — 48x48 web
  await render(buildIconSvg({ size: 1024 }), `${OUT}/favicon.png`, 48);

  console.log('\nAll icons generated.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
