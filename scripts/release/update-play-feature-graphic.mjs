/**
 * Google Play のフィーチャーグラフィック（featureGraphic）を
 * docs/store/google-play/graphics/（node scripts/generate-play-promos.mjs の出力）で差し替える。
 *
 * **言語ごとに持てる。** 英語掲載に日本語のバナーが出ていては、掲載文だけ
 * 英語にしても意味がない。Play の edit は同時に 1 つだけなので言語ごとに実行する。
 *
 * 使い方: node scripts/release/update-play-feature-graphic.mjs [--lang ja-JP|en-US] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEditsClient, getAccessToken } from './lib/play-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_BY_LANG = {
  'ja-JP': 'docs/store/google-play/graphics/feature-graphic.png',
  'en-US': 'docs/store/google-play/graphics/feature-graphic-en.png',
};
const langIndex = process.argv.indexOf('--lang');
const LANG = langIndex === -1 ? 'ja-JP' : process.argv[langIndex + 1];
if (!(LANG in SOURCE_BY_LANG)) {
  throw new Error(
    `--lang は ${Object.keys(SOURCE_BY_LANG).join(' / ')} のいずれか（受領: ${LANG}）`,
  );
}
const SOURCE = path.join(ROOT, SOURCE_BY_LANG[LANG]);
const IMAGE_TYPE = 'featureGraphic';
const DRY_RUN = process.argv.includes('--dry-run');

if (!fs.existsSync(SOURCE)) throw new Error(`missing: ${SOURCE}`);
const bytes = fs.statSync(SOURCE).size;
console.log(`prepared (${LANG}): ${SOURCE} ${Math.round(bytes / 1024)}KB`);
if (bytes > 15 * 1024 * 1024) throw new Error('Play の上限 15MB を超えています');

if (DRY_RUN) {
  console.log('--- dry-run: 送信せず終了 ---');
  process.exit(0);
}

const client = createEditsClient(await getAccessToken());
const edit = await client.insert();
await client.deleteAllImages(edit.id, LANG, IMAGE_TYPE);
const uploaded = await client.uploadImage(edit.id, LANG, IMAGE_TYPE, SOURCE);
console.log('uploaded:', uploaded.image?.id ?? uploaded);
const commit = await client.commit(edit.id);
console.log('COMMITTED edit:', commit.id);
