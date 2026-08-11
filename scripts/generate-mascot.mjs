/**
 * 相談相手のマスコット「おたま」を生成する。
 * 出力: apps/mobile/assets/mascot/
 *
 * ホーランドロップのうさぎ＋コック帽。**白とモカのミックス**で、背景は透過にする
 * （吹き出しの上・空状態の上のどちらにも置くため）。
 *
 * 意匠の決めどころ:
 * - 垂れ耳は**右だけ定義して左は左右反転**。左右で式を分けると必ず崩れる。
 *   付け根は頭の輪郭の内側に置き、耳を先に描いて頭で隠す（浮いて見えるのを防ぐ）
 * - コック帽は幅より**高さ**を出す。平たいとパンに見える
 * - 判断は必ず 40px（吹き出し横のアバター実寸）まで縮めてから
 *   — 細い線やほおの陰は縮小で最初に消える
 */
import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const BG = '#0A0805';
// モカ。ブランドのゴールド(#C9A16A)より茶に寄せて、アプリアイコンと混同しないようにする
const MOCHA = '#B08968';
const MOCHA_DARK = '#8B6A4F';
const CREAM = '#E6D6BE';
// 白×モカのミックス（ホーランドロップによくある柄）
const WHITE = '#F3ECE0';
const HAT = '#EFE6D4';
const OUT = 'apps/mobile/assets/mascot';

/** うさぎの鼻と口（Y字）。 */
function noseAndMouth(cx, cy) {
  const w = 4.2;
  const h = 3.2;
  return `
    <path d="M ${cx - w} ${cy - h} Q ${cx} ${cy - h * 1.5}, ${cx + w} ${cy - h}
             Q ${cx + w * 0.5} ${cy + h * 0.9}, ${cx} ${cy + h}
             Q ${cx - w * 0.5} ${cy + h * 0.9}, ${cx - w} ${cy - h} Z" fill="${BG}"/>
    <path d="M ${cx} ${cy + h} L ${cx} ${cy + h + 3}
             M ${cx} ${cy + h + 3} Q ${cx - 4.5} ${cy + h + 6.5}, ${cx - 7} ${cy + h + 2.5}
             M ${cx} ${cy + h + 3} Q ${cx + 4.5} ${cy + h + 6.5}, ${cx + 7} ${cy + h + 2.5}"
      stroke="${BG}" stroke-width="2.1" fill="none" stroke-linecap="round"/>`;
}

/** コック帽。ふくらみ 3 つ＋鉢巻。**幅より高さ**を出さないとパンに見える。 */
function chefHat(cx, topY, w, h) {
  const half = w / 2;
  const bandH = h * 0.26;
  const puffH = h - bandH;
  return `
    <circle cx="${cx - half * 0.62}" cy="${topY + puffH * 0.46}" r="${puffH * 0.44}" fill="${HAT}"/>
    <circle cx="${cx + half * 0.62}" cy="${topY + puffH * 0.46}" r="${puffH * 0.44}" fill="${HAT}"/>
    <circle cx="${cx}" cy="${topY + puffH * 0.36}" r="${puffH * 0.5}" fill="${HAT}"/>
    <rect x="${cx - half * 0.9}" y="${topY + puffH * 0.5}" width="${half * 1.8}" height="${puffH * 0.55}" fill="${HAT}"/>
    <rect x="${cx - half}" y="${topY + puffH}" width="${w}" height="${bandH}"
      rx="${bandH * 0.45}" fill="${HAT}"/>`;
}

/**
 * 垂れ耳。**右耳だけ定義し、左は左右反転で作る**（左右で式を分けると必ず崩れる）。
 * 付け根は頭の輪郭の内側に置き、耳を先に描いて頭で隠す。
 * 形は「付け根が細く、途中でふくらみ、先が丸い」— ホーランドロップの実物に近い。
 */
function lopEarRight() {
  return `
    <path d="M 60 46
             C 80 44, 92 58, 90 74
             C 88 90, 77 100, 67 96
             C 60 93, 57 76, 58 56 Z" fill="${MOCHA}"/>
    <path d="M 65 53
             C 78 53, 84 63, 83 75
             C 82 86, 76 92, 70 89
             C 65 86, 63 72, 63 59 Z" fill="${MOCHA_DARK}" opacity="0.45"/>`;
}

function lopEars() {
  return `
    ${lopEarRight()}
    <g transform="translate(100 0) scale(-1 1)">${lopEarRight()}</g>`;
}

/**
 * 顔。上半分がモカ、下半分と口まわりが白、額から鼻へ細いブレーズ。
 * ブレーズがあると顔の中心が決まり、40px でも顔だと分かる。
 */
function face() {
  return `
    <ellipse cx="50" cy="56" rx="21" ry="20" fill="${MOCHA}"/>
    <path d="M 29 56 A 21 20 0 0 0 71 56 L 71 58 A 21 20 0 0 1 29 58 Z" fill="${WHITE}"/>
    <ellipse cx="50" cy="66" rx="18" ry="13" fill="${WHITE}"/>
    <path d="M 50 34 Q 57 46, 55 62 L 45 62 Q 43 46, 50 34 Z" fill="${WHITE}"/>
    <ellipse cx="34" cy="61" rx="4.2" ry="2.8" fill="${MOCHA_DARK}" opacity="0.35"/>
    <ellipse cx="66" cy="61" rx="4.2" ry="2.8" fill="${MOCHA_DARK}" opacity="0.35"/>
    <ellipse cx="40" cy="53" rx="3.9" ry="4.7" fill="${BG}"/>
    <ellipse cx="60" cy="53" rx="3.9" ry="4.7" fill="${BG}"/>
    ${noseAndMouth(50, 62)}`;
}

function buildMascotSvg(size) {
  const s = size / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <g transform="scale(${s})">
    ${lopEars()}
    <g transform="rotate(-8 50 26)">${chefHat(50, 8, 34, 28)}</g>
    ${face()}
  </g>
</svg>`;
}

async function render(size, outPath) {
  await sharp(Buffer.from(buildMascotSvg(size)), { density: 600 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (${size}x${size})`);
}

async function main() {
  if (!existsSync(OUT)) await mkdir(OUT, { recursive: true });
  // 空状態などで大きく出す用
  await render(512, `${OUT}/otama.png`);
  // 吹き出し横のアバター用（実表示 40px の 3 倍）
  await render(120, `${OUT}/otama-avatar.png`);
  console.log('\nMascot generated.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
