/**
 * Google Play のストア掲載アイコン（ja-JP / icon）を
 * apps/mobile/assets/icon.png（512x512 にリサイズ）で差し替える。
 *
 * アプリ本体の起動アイコン（apps/mobile/assets/icon.png 自体）とは別物 —
 * こちらは Play Console の「アプリのアイコン」欄で、次のアプリビルドを
 * 待たずに即時反映される（検索結果・ストアページに表示される絵）。
 * アプリ本体アイコンとの整合は次回ビルド（1.5.0）で自動的に取れる
 * （両方とも scripts/generate-icons.mjs の同じ意匠から生成されるため）。
 *
 * 使い方: node scripts/release/update-play-icon.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { createEditsClient, getAccessToken } from './lib/play-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = path.join(ROOT, 'apps/mobile/assets/icon.png');
const TMP = path.join(ROOT, 'scripts/release/.tmp-play-icon-512.png');
const LANG = 'ja-JP';
const IMAGE_TYPE = 'icon';
const DRY_RUN = process.argv.includes('--dry-run');

if (!fs.existsSync(SOURCE)) throw new Error(`missing: ${SOURCE}`);

await sharp(SOURCE).resize(512, 512).png({ compressionLevel: 9 }).toFile(TMP);
const bytes = fs.statSync(TMP).size;
console.log(`prepared: ${TMP} 512x512 ${Math.round(bytes / 1024)}KB`);
if (bytes > 1024 * 1024) throw new Error('Play の上限 1MB を超えています');

if (DRY_RUN) {
  console.log('--- dry-run: 送信せず終了 ---');
  process.exit(0);
}

const client = createEditsClient(await getAccessToken());
const edit = await client.insert();
await client.deleteAllImages(edit.id, LANG, IMAGE_TYPE);
const uploaded = await client.uploadImage(edit.id, LANG, IMAGE_TYPE, TMP);
console.log('uploaded:', uploaded.image?.id ?? uploaded);
const commit = await client.commit(edit.id);
console.log('COMMITTED edit:', commit.id);

fs.rmSync(TMP, { force: true });
