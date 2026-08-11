/**
 * Google Play のスマホ用スクリーンショット（phoneScreenshots）を
 * docs/store/google-play/phone-screenshots<-locale>/ の内容で差し替える。
 *
 * - 表示順 = ORDER 配列（README.md の表と一致させる）
 * - 既存を全削除してから順番にアップロード（アップロード順が表示順になる）
 * - 認証は lib/play-api.mjs（サービスアカウント）
 * - **1 回の実行で 1 言語だけ**（Play の edit は同時に 1 つしか開けない）
 *
 * 使い方: node scripts/release/update-play-screenshots.mjs [--lang ja-JP|en-US] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEditsClient, getAccessToken } from './lib/play-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 言語ごとの取得先ディレクトリ。日本語は既存パスのまま（履歴を壊さない）。 */
const SHOTS_DIR_BY_LANG = {
  'ja-JP': 'docs/store/google-play/phone-screenshots',
  'en-US': 'docs/store/google-play/phone-screenshots-en',
};

const langIndex = process.argv.indexOf('--lang');
const LANG = langIndex === -1 ? 'ja-JP' : process.argv[langIndex + 1];
if (!(LANG in SHOTS_DIR_BY_LANG)) {
  throw new Error(
    `--lang は ${Object.keys(SHOTS_DIR_BY_LANG).join(' / ')} のいずれか（受領: ${LANG}）`,
  );
}
const SHOTS_DIR = path.join(ROOT, SHOTS_DIR_BY_LANG[LANG]);
const IMAGE_TYPE = 'phoneScreenshots';
const DRY_RUN = process.argv.includes('--dry-run');

/** アップロード順（= Play の表示順）。各ディレクトリの README.md の表と同期すること。 */
const ORDER_BY_LANG = {
  'ja-JP': [
    '10-recipe-detail-photo.png',
    '07-photo-to-recipe.png',
    '08-photo-recipe-result.png',
    '01-home-timeline.png',
    '02-recipe-library.png',
    '03-recipe-detail.png',
    '04-cooking-mode.png',
    '06-family-group.png',
  ],
  'en-US': [
    '10-recipe-detail-photo.png',
    '07-photo-to-recipe.png',
    '08-photo-recipe-result.png',
    '01-home-timeline.png',
    '02-recipe-library.png',
    '03-recipe-detail.png',
    '04-cooking-mode.png',
    '06-family-group.png',
  ],
};
const ORDER = ORDER_BY_LANG[LANG];

// ─── 検証（存在・PNG・寸法・8枚以内） ────────────────────────────────────────
if (ORDER.length > 8) throw new Error(`Play のスマホスクショは最大8枚（現在 ${ORDER.length}）`);
const plan = ORDER.map((file) => {
  const p = path.join(SHOTS_DIR, file);
  if (!fs.existsSync(p)) throw new Error(`missing: ${file}`);
  const b = fs.readFileSync(p);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`not PNG: ${file}`);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (Math.min(w, h) < 320 || Math.max(w, h) > 3840)
    throw new Error(`寸法が Play 要件外 (320..3840): ${file} ${w}x${h}`);
  return { file, path: p, dims: `${w}x${h}`, kb: Math.round(b.length / 1024) };
});

console.log(`plan (${plan.length} files, ${LANG}/${IMAGE_TYPE}):`);
for (const [i, s] of plan.entries()) console.log(`  ${i + 1}. ${s.file} ${s.dims} ${s.kb}KB`);

if (DRY_RUN) {
  console.log('--- dry-run: 送信せず終了 ---');
  process.exit(0);
}

// ─── edits フロー: insert → deleteall → upload×N → commit ────────────────────
const client = createEditsClient(await getAccessToken());
const edit = await client.insert();
console.log('edit:', edit.id);

await client.deleteAllImages(edit.id, LANG, IMAGE_TYPE);
console.log('deleted existing images');

for (const s of plan) {
  const res = await client.uploadImage(edit.id, LANG, IMAGE_TYPE, s.path);
  console.log(`uploaded: ${s.file} -> ${res.image?.id ?? 'ok'}`);
}

const commit = await client.commit(edit.id);
console.log('COMMITTED edit:', commit.id);
