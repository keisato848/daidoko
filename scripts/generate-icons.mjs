/**
 * Generate Expo app icons from the brand SVG (logo-seal).
 * Outputs to apps/mobile/assets/
 *
 * Expo expects:
 *   icon.png            — 1024x1024 (main, square, app launcher)
 *   adaptive-icon.png   — 1024x1024 (Android foreground, with safe area)
 *   splash-icon.png     — 1024x1024 (splash screen, centered logo)
 *   favicon.png         — 48x48 (web)
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const BG = '#0A0805';
const GOLD = '#C9A16A';
const PAPER = '#DCC9A8';
const GOLD_DIM = '#A07A44';
const BORDER = '#2E2418';
const OUT = 'apps/mobile/assets';

// SVG factory: cx/cy are center, r is the seal radius.
// For app icon: padding + seal that fills most of canvas.
// For adaptive foreground: seal in the inner ~66% safe area (transparent bg).
function buildSealSvg({ size, padding = 0, transparent = false, scale = 1.0 }) {
  const cx = size / 2;
  const cy = size / 2;
  const usable = size - padding * 2;
  const r = (usable / 2) * 0.95 * scale;
  const innerR = r * 0.89;
  // Stroke widths scale with size
  const outerStroke = r * 0.016;
  const innerStroke = r * 0.008;
  // Font sizes scale relative to r
  const seal = r * 0.64; // 臺所
  const sub = r * 0.13; // DAIDOKO
  // Y coordinates relative to center
  const sealY = cy + seal * 0.32; // text baseline tweak
  const lineY = cy + r * 0.45;
  const subY = cy + r * 0.66;
  const dotR = r * 0.04;

  const bgRect = transparent
    ? ''
    : `<rect width="${size}" height="${size}" fill="${BG}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  ${bgRect}
  <!-- 外円 -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${GOLD}" stroke-width="${outerStroke}"/>
  <!-- 内円（破線） -->
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="${BORDER}" stroke-width="${innerStroke}" stroke-dasharray="${r * 0.05} ${r * 0.05}"/>
  <!-- 臺所 -->
  <text x="${cx}" y="${sealY}" text-anchor="middle"
        font-family="'Yu Mincho','Hiragino Mincho ProN','Noto Serif JP','Source Han Serif','Liberation Serif',serif"
        font-size="${seal}" fill="${PAPER}">臺所</text>
  <!-- 区切り線 -->
  <line x1="${cx - r * 0.55}" y1="${lineY}" x2="${cx + r * 0.55}" y2="${lineY}" stroke="${BORDER}" stroke-width="${innerStroke}"/>
  <!-- DAIDOKO -->
  <text x="${cx}" y="${subY}" text-anchor="middle"
        font-family="'Cormorant Garamond','Georgia',serif"
        font-size="${sub}" font-style="italic" fill="${GOLD_DIM}" letter-spacing="${sub * 0.5}">D A I D O K O</text>
  <!-- 四方の点 -->
  <circle cx="${cx}" cy="${cy - r}" r="${dotR}" fill="${GOLD}"/>
  <circle cx="${cx}" cy="${cy + r}" r="${dotR}" fill="${GOLD}"/>
  <circle cx="${cx - r}" cy="${cy}" r="${dotR}" fill="${GOLD}"/>
  <circle cx="${cx + r}" cy="${cy}" r="${dotR}" fill="${GOLD}"/>
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

  // 1. Main icon — full canvas, dark bg, seal fills 95%
  await render(buildSealSvg({ size: 1024, padding: 0 }), `${OUT}/icon.png`, 1024);

  // 2. Adaptive icon foreground — transparent, seal at 60% (Android safe area)
  await render(
    buildSealSvg({ size: 1024, transparent: true, scale: 0.62 }),
    `${OUT}/adaptive-icon.png`,
    1024,
  );

  // 3. Splash icon — dark bg, seal at 50%
  await render(
    buildSealSvg({ size: 1024, scale: 0.5 }),
    `${OUT}/splash-icon.png`,
    1024,
  );

  // 4. Favicon — 48x48 web
  await render(buildSealSvg({ size: 1024 }), `${OUT}/favicon.png`, 48);

  console.log('\nAll icons generated.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
