/**
 * Google Play 掲載情報を docs/store/google-play/listing-<lang>.md の内容で更新する。
 *
 * - 単一ソース: 各 md の「## アプリ名」「## 短い説明」「## 詳しい説明」を反映する
 * - 動画は Play 側の現行値を維持する
 * - 認証: サービスアカウント JSON（既定 C:/secure/play-service-account.json、
 *   環境変数 PLAY_SERVICE_ACCOUNT_KEY で上書き可）。キーの値は一切出力しない。
 *
 * 使い方:
 *   node scripts/release/update-play-listing.mjs [--dry-run]            # ja-JP
 *   node scripts/release/update-play-listing.mjs --lang en-US [--dry-run]
 *
 * **1回の実行で1言語だけ**にしている。Play の edit は同時に1つしか開けず、
 * まとめて流すと途中で失敗したとき何が反映済みか分からなくなるため。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEditsClient, getAccessToken } from './lib/play-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRY_RUN = process.argv.includes('--dry-run');

const LANG_INDEX = process.argv.indexOf('--lang');
const LANG = LANG_INDEX === -1 ? 'ja-JP' : process.argv[LANG_INDEX + 1];
const SOURCE_BY_LANG = { 'ja-JP': 'listing-ja.md', 'en-US': 'listing-en.md' };
const SOURCE = SOURCE_BY_LANG[LANG];
if (!SOURCE) {
  throw new Error(`未対応の言語: ${LANG}（対応: ${Object.keys(SOURCE_BY_LANG).join(', ')}）`);
}
const LISTING_MD = path.join(ROOT, 'docs/store/google-play', SOURCE);

// ─── listing-ja.md からセクション抽出 ───────────────────────────────────────
function extractSection(md, heading) {
  const re = new RegExp(`^## ${heading}\\s*$`, 'm');
  const m = re.exec(md);
  if (!m) throw new Error(`${SOURCE} に「## ${heading}」が見つかりません`);
  const start = m.index + m[0].length;
  const next = md.slice(start).search(/^## /m);
  const body = (next === -1 ? md.slice(start) : md.slice(start, start + next)).trim();
  if (!body) throw new Error(`「## ${heading}」の本文が空です`);
  return body;
}

/**
 * Play の掲載文は**マークダウンを解釈しない**。`**強調**` をそのまま送ると、
 * 利用者にはアスタリスクが 4 つそのまま見える（2026-08-26 の公開前点検で
 * 日本語版 4 か所・英語版 3 か所が残っていた）。
 *
 * 原稿側は読みやすさのために `**` を使いたいので、**送る直前にここで落とす**。
 * 強調の意図は原稿に残り、Play にはプレーンテキストが届く。
 */
function stripMarkdownEmphasis(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
}

const md = fs.readFileSync(LISTING_MD, 'utf8');
const TITLE = stripMarkdownEmphasis(extractSection(md, 'アプリ名').replace(/^-\s*/, '').trim());
const SHORT = stripMarkdownEmphasis(extractSection(md, '短い説明'));
const FULL = stripMarkdownEmphasis(extractSection(md, '詳しい説明'));

if (TITLE.length > 30) throw new Error(`アプリ名が30字超: ${TITLE.length}`);
if (SHORT.length > 80) throw new Error(`短い説明が80字超: ${SHORT.length}`);
if (FULL.length > 4000) throw new Error(`詳しい説明が4000字超: ${FULL.length}`);
console.log(`[${LANG}] ${SOURCE}`);
console.log(`title: ${TITLE.length}字 / short: ${SHORT.length}字 / full: ${FULL.length}字`);

if (/\*/.test(`${TITLE}${SHORT}${FULL}`)) {
  throw new Error('送信するテキストに `*` が残っています（マークダウンの取りこぼし）');
}

if (DRY_RUN) {
  console.log('--- dry-run: 送信せず終了 ---');
  console.log(TITLE);
  console.log(SHORT);
  process.exit(0);
}

// ─── edits フロー: insert → listings.get → listings.update → commit ─────────
const client = createEditsClient(await getAccessToken());
const edit = await client.insert();

// 新しい言語を足すときは掲載がまだ無い（404）。その場合は新規作成として続ける
const cur = await client.getListing(edit.id, LANG).catch(() => ({}));
console.log('current title:', cur.title ?? '(掲載なし → 新規作成)', '-> new:', TITLE);

await client.updateListing(edit.id, LANG, {
  language: LANG,
  title: TITLE,
  shortDescription: SHORT,
  fullDescription: FULL,
  ...(cur.video ? { video: cur.video } : {}),
});

const commit = await client.commit(edit.id);
console.log('COMMITTED edit:', commit.id);
