import { mkdir } from 'node:fs/promises';

import sharp from 'sharp';

const WIDTH = 1080;
const HEIGHT = 2400;
const OUTPUT_DIR = 'docs/store/google-play/promotional-screenshots';
const ICON_PATH = 'docs/store/google-play/icons/icon-play-512.png';
const GRAPHICS_DIR = 'docs/store/google-play/graphics';
const FEATURE_GRAPHIC_PATH = `${GRAPHICS_DIR}/feature-graphic.png`;
const FEATURE_GRAPHIC_WIDTH = 1024;
const FEATURE_GRAPHIC_HEIGHT = 500;

const slides = [
  {
    input: 'docs/store/google-play/phone-screenshots/01-home-timeline.png',
    output: '01-home-timeline-promo.png',
    eyebrow: 'TIMELINE',
    title: '家族の台所が一冊に',
    subtitle: '最近の調理記録を、毎日の流れのまま振り返る。',
  },
  {
    input: 'docs/store/google-play/phone-screenshots/02-recipe-library.png',
    output: '02-recipe-library-promo.png',
    eyebrow: 'SEARCH',
    title: '定番レシピをすぐ検索',
    subtitle: '食材名やタグから、作りたい料理へすばやく到達。',
  },
  {
    input: 'docs/store/google-play/phone-screenshots/03-recipe-detail.png',
    output: '03-recipe-detail-promo.png',
    eyebrow: 'DETAIL',
    title: '材料と手順を迷わず確認',
    subtitle: '材料、手順、履歴をひとつの詳細画面に整理。',
  },
  {
    input: 'docs/store/google-play/phone-screenshots/04-cooking-mode.png',
    output: '04-cooking-mode-promo.png',
    eyebrow: 'COOK MODE',
    title: '料理中は次の一手だけ',
    subtitle: '大きな手順表示で、台所でも流れを見失わない。',
  },
  {
    input: 'docs/store/google-play/phone-screenshots/05-ocr-import.png',
    output: '05-ocr-import-promo.png',
    eyebrow: 'IMPORT',
    title: '紙のレシピも取り込める',
    subtitle: '画像から OCR で下書きを作り、あとから整えられる。',
  },
  {
    input: 'docs/store/google-play/phone-screenshots/06-family-group.png',
    output: '06-family-group-promo.png',
    eyebrow: 'FAMILY',
    title: '家族で育てるレシピ手帳',
    subtitle: '家族グループ情報や招待コードもひとつにまとまる。',
  },
];

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapText(text, maxCharsPerLine) {
  const chars = Array.from(text);
  const lines = [];
  for (let index = 0; index < chars.length; index += maxCharsPerLine) {
    lines.push(chars.slice(index, index + maxCharsPerLine).join(''));
  }
  const leadingPunctuation = new Set(['。', '、', '！', '？', '」', '』']);
  for (let index = 1; index < lines.length; index += 1) {
    while (lines[index] && leadingPunctuation.has(lines[index][0]) && lines[index - 1]) {
      lines[index - 1] += lines[index][0];
      lines[index] = lines[index].slice(1);
    }
  }
  return lines.filter(Boolean);
}

function buildTextSvg({ eyebrow, title, subtitle }) {
  const titleLines = wrapText(title, 12);
  const subtitleLines = wrapText(subtitle, 21);
  const titleTspans = titleLines
    .map(
      (line, index) =>
        `<tspan x="112" dy="${index === 0 ? 0 : 84}">${escapeXml(line)}</tspan>`,
    )
    .join('');
  const subtitleTspans = subtitleLines
    .map(
      (line, index) =>
        `<tspan x="112" dy="${index === 0 ? 0 : 42}">${escapeXml(line)}</tspan>`,
    )
    .join('');

  return Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#16110B"/>
          <stop offset="42%" stop-color="#0A0805"/>
          <stop offset="100%" stop-color="#090705"/>
        </linearGradient>
        <radialGradient id="halo" cx="78%" cy="12%" r="40%">
          <stop offset="0%" stop-color="#3A2B17" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#3A2B17" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#D4B078"/>
          <stop offset="100%" stop-color="#7E5B2F"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#halo)"/>
      <rect x="52" y="52" width="${WIDTH - 104}" height="${HEIGHT - 104}" rx="36" fill="none" stroke="#2E2418" stroke-width="2"/>
      <rect x="64" y="64" width="${WIDTH - 128}" height="${HEIGHT - 128}" rx="32" fill="none" stroke="url(#frame)" stroke-opacity="0.8" stroke-width="2.4"/>
      <circle cx="942" cy="188" r="122" fill="#C9A16A" fill-opacity="0.06"/>
      <circle cx="140" cy="2088" r="148" fill="#C9A16A" fill-opacity="0.04"/>
      <path d="M112 336 H968" stroke="#C9A16A" stroke-opacity="0.35" stroke-width="2"/>
      <text x="112" y="210" fill="#C9A16A" font-size="26" font-weight="700" letter-spacing="5" font-family="Yu Gothic UI, Yu Gothic, sans-serif">${escapeXml(eyebrow)}</text>
      <text x="112" y="292" fill="#DCC9A8" font-size="74" font-weight="700" letter-spacing="1.5" font-family="Yu Mincho, YuMincho, serif">${titleTspans}</text>
      <text x="112" y="436" fill="#DCC9A8" fill-opacity="0.86" font-size="31" font-weight="500" letter-spacing="0.8" font-family="Yu Gothic UI, Yu Gothic, sans-serif">${subtitleTspans}</text>
      <text x="196" y="112" fill="#DCC9A8" font-size="36" font-weight="700" letter-spacing="8" font-family="Yu Mincho, YuMincho, serif">臺所</text>
      <text x="198" y="150" fill="#A07A44" font-size="20" font-style="italic" letter-spacing="4" font-family="Georgia, Times New Roman, serif">D A I D O K O</text>
      <rect x="112" y="520" width="856" height="1716" rx="44" fill="#090705" stroke="#C9A16A" stroke-opacity="0.55" stroke-width="3"/>
      <rect x="132" y="540" width="816" height="1676" rx="36" fill="#14100B"/>
    </svg>
  `);
}

function buildShadowSvg(width, height, radius = 28) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="26" stdDeviation="22" flood-color="#000000" flood-opacity="0.42"/>
        </filter>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="#000000" fill-opacity="0.01" filter="url(#shadow)"/>
      <rect x="2" y="2" width="${width - 4}" height="${height - 4}" rx="${Math.max(radius - 2, 0)}" fill="none" stroke="#D4B078" stroke-opacity="0.45" stroke-width="2"/>
    </svg>
  `);
}

function buildFeatureGraphicSvg() {
  return Buffer.from(`
    <svg width="${FEATURE_GRAPHIC_WIDTH}" height="${FEATURE_GRAPHIC_HEIGHT}" viewBox="0 0 ${FEATURE_GRAPHIC_WIDTH} ${FEATURE_GRAPHIC_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#16110B"/>
          <stop offset="58%" stop-color="#0A0805"/>
          <stop offset="100%" stop-color="#120D08"/>
        </linearGradient>
        <radialGradient id="glowA" cx="16%" cy="14%" r="48%">
          <stop offset="0%" stop-color="#C9A16A" stop-opacity="0.24"/>
          <stop offset="100%" stop-color="#C9A16A" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="glowB" cx="88%" cy="88%" r="42%">
          <stop offset="0%" stop-color="#5B4120" stop-opacity="0.34"/>
          <stop offset="100%" stop-color="#5B4120" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#D4B078"/>
          <stop offset="100%" stop-color="#7E5B2F"/>
        </linearGradient>
      </defs>
      <rect width="${FEATURE_GRAPHIC_WIDTH}" height="${FEATURE_GRAPHIC_HEIGHT}" rx="36" fill="url(#bg)"/>
      <rect width="${FEATURE_GRAPHIC_WIDTH}" height="${FEATURE_GRAPHIC_HEIGHT}" rx="36" fill="url(#glowA)"/>
      <rect width="${FEATURE_GRAPHIC_WIDTH}" height="${FEATURE_GRAPHIC_HEIGHT}" rx="36" fill="url(#glowB)"/>
      <rect x="18" y="18" width="${FEATURE_GRAPHIC_WIDTH - 36}" height="${FEATURE_GRAPHIC_HEIGHT - 36}" rx="28" fill="none" stroke="#2E2418" stroke-width="2"/>
      <rect x="28" y="28" width="${FEATURE_GRAPHIC_WIDTH - 56}" height="${FEATURE_GRAPHIC_HEIGHT - 56}" rx="24" fill="none" stroke="url(#frame)" stroke-opacity="0.82" stroke-width="2.2"/>
      <circle cx="144" cy="96" r="82" fill="#C9A16A" fill-opacity="0.08"/>
      <circle cx="920" cy="96" r="96" fill="#C9A16A" fill-opacity="0.05"/>
      <circle cx="868" cy="420" r="138" fill="#C9A16A" fill-opacity="0.04"/>
      <path d="M176 186 H454" stroke="#C9A16A" stroke-opacity="0.34" stroke-width="2"/>
      <text x="176" y="86" fill="#DCC9A8" font-size="22" font-weight="700" letter-spacing="6" font-family="Yu Gothic UI, Yu Gothic, sans-serif">FAMILY RECIPE NOTEBOOK</text>
      <text x="176" y="148" fill="#F0E6D2" font-size="54" font-weight="700" letter-spacing="10" font-family="Yu Mincho, YuMincho, serif">臺所</text>
      <text x="178" y="178" fill="#A07A44" font-size="18" font-style="italic" letter-spacing="5" font-family="Georgia, Times New Roman, serif">D A I D O K O</text>
      <text x="88" y="258" fill="#DCC9A8" font-size="42" font-weight="700" letter-spacing="1.5" font-family="Yu Mincho, YuMincho, serif">家族の台所を、</text>
      <text x="88" y="312" fill="#DCC9A8" font-size="42" font-weight="700" letter-spacing="1.5" font-family="Yu Mincho, YuMincho, serif">一冊の手帳に。</text>
      <text x="88" y="370" fill="#DCC9A8" fill-opacity="0.88" font-size="23" font-weight="500" letter-spacing="0.8" font-family="Yu Gothic UI, Yu Gothic, sans-serif">レシピ、手順、調理記録をローカル中心で静かに積み重ねる。</text>
      <text x="88" y="407" fill="#DCC9A8" fill-opacity="0.76" font-size="21" font-weight="500" letter-spacing="0.6" font-family="Yu Gothic UI, Yu Gothic, sans-serif">検索、料理中モード、OCR 取り込みまで、毎日の家庭料理をひとつに整理。</text>
      <rect x="88" y="431" width="188" height="1.5" fill="#C9A16A" fill-opacity="0.42"/>
    </svg>
  `);
}

async function renderSlide(slide) {
  const background = sharp(buildTextSvg(slide));
  const screenWidth = 812;
  const screenHeight = 1804;
  const screen = await sharp(slide.input)
    .resize(screenWidth, screenHeight, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();
  const mask = await sharp({
    create: {
      width: screenWidth,
      height: screenHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${screenWidth}" height="${screenHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="${screenWidth}" height="${screenHeight}" rx="28" fill="#ffffff"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
  const roundedScreen = await sharp(screen)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const shadow = buildShadowSvg(screenWidth, screenHeight);

  await background
    .composite([
      { input: await sharp(ICON_PATH).resize(68, 68).png().toBuffer(), left: 112, top: 92 },
      { input: shadow, left: 134, top: 596 },
      { input: roundedScreen, left: 156, top: 618 },
    ])
    .png()
    .toFile(`${OUTPUT_DIR}/${slide.output}`);
}

async function renderFeatureGraphic() {
  const screenshotWidth = 214;
  const screenshotHeight = 476;
  const screenshotRadius = 24;
  const screenshot = await sharp(slides[0].input)
    .resize(screenshotWidth, screenshotHeight, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();
  const screenshotMask = await sharp({
    create: {
      width: screenshotWidth,
      height: screenshotHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${screenshotWidth}" height="${screenshotHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="${screenshotWidth}" height="${screenshotHeight}" rx="${screenshotRadius}" fill="#ffffff"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
  const roundedScreenshot = await sharp(screenshot)
    .composite([{ input: screenshotMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const screenshotShadow = buildShadowSvg(screenshotWidth, screenshotHeight, screenshotRadius);

  await sharp(buildFeatureGraphicSvg())
    .composite([
      { input: await sharp(ICON_PATH).resize(72, 72).png().toBuffer(), left: 88, top: 58 },
      { input: screenshotShadow, left: 724, top: 12 },
      { input: roundedScreenshot, left: 740, top: 28 },
    ])
    .png()
    .toFile(FEATURE_GRAPHIC_PATH);
}

await mkdir(OUTPUT_DIR, { recursive: true });
await mkdir(GRAPHICS_DIR, { recursive: true });
await Promise.all([Promise.all(slides.map(renderSlide)), renderFeatureGraphic()]);

console.log(`Generated ${slides.length} promotional screenshots in ${OUTPUT_DIR} and feature graphic at ${FEATURE_GRAPHIC_PATH}`);