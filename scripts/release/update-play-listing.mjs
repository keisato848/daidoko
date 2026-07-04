/**
 * Google Play 掲載情報（ja-JP）を docs/store/google-play/listing-ja.md の内容で更新する。
 *
 * - 単一ソース: listing-ja.md の「## 短い説明」「## 詳しい説明」を反映する
 * - タイトルと動画は Play 側の現行値を維持する
 * - 認証: サービスアカウント JSON（既定 C:/secure/play-service-account.json、
 *   環境変数 PLAY_SERVICE_ACCOUNT_KEY で上書き可）。キーの値は一切出力しない。
 *
 * 使い方: node scripts/release/update-play-listing.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LISTING_MD = path.join(ROOT, 'docs/store/google-play/listing-ja.md');
const KEY_PATH = process.env.PLAY_SERVICE_ACCOUNT_KEY ?? 'C:/secure/play-service-account.json';
const PACKAGE = 'com.daidoko.app';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── listing-ja.md からセクション抽出 ───────────────────────────────────────
function extractSection(md, heading) {
  const re = new RegExp(`^## ${heading}\\s*$`, 'm');
  const m = re.exec(md);
  if (!m) throw new Error(`listing-ja.md に「## ${heading}」が見つかりません`);
  const start = m.index + m[0].length;
  const next = md.slice(start).search(/^## /m);
  const body = (next === -1 ? md.slice(start) : md.slice(start, start + next)).trim();
  if (!body) throw new Error(`「## ${heading}」の本文が空です`);
  return body;
}

const md = fs.readFileSync(LISTING_MD, 'utf8');
const SHORT = extractSection(md, '短い説明');
const FULL = extractSection(md, '詳しい説明');

if (SHORT.length > 80) throw new Error(`短い説明が80字超: ${SHORT.length}`);
if (FULL.length > 4000) throw new Error(`詳しい説明が4000字超: ${FULL.length}`);
console.log(`short: ${SHORT.length}字 / full: ${FULL.length}字`);

if (DRY_RUN) {
  console.log('--- dry-run: 送信せず終了 ---');
  console.log(SHORT);
  process.exit(0);
}

// ─── サービスアカウントで androidpublisher トークン取得 ─────────────────────
const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: key.client_email,
  scope: 'https://www.googleapis.com/auth/androidpublisher',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
})}`;
const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key).toString('base64url');

const tokRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
});
const tok = await tokRes.json();
if (!tok.access_token)
  throw new Error(`token failed: ${tokRes.status} ${JSON.stringify(tok).slice(0, 200)}`);

// ─── edits フロー: insert → listings.get → listings.update → commit ─────────
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const h = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };

const edit = await (
  await fetch(`${base}/edits`, { method: 'POST', headers: h, body: '{}' })
).json();
if (!edit.id) throw new Error(`edit insert failed: ${JSON.stringify(edit).slice(0, 300)}`);

const cur = await (await fetch(`${base}/edits/${edit.id}/listings/ja-JP`, { headers: h })).json();
console.log('current title:', cur.title);

const body = {
  language: 'ja-JP',
  title: cur.title,
  shortDescription: SHORT,
  fullDescription: FULL,
  ...(cur.video ? { video: cur.video } : {}),
};
const updRes = await fetch(`${base}/edits/${edit.id}/listings/ja-JP`, {
  method: 'PUT',
  headers: h,
  body: JSON.stringify(body),
});
if (!updRes.ok)
  throw new Error(`update failed: ${JSON.stringify(await updRes.json()).slice(0, 400)}`);

const commitRes = await fetch(`${base}/edits/${edit.id}:commit`, { method: 'POST', headers: h });
const commit = await commitRes.json();
if (!commitRes.ok) throw new Error(`commit failed: ${JSON.stringify(commit).slice(0, 400)}`);
console.log('COMMITTED edit:', commit.id);
