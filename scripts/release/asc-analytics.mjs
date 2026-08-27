#!/usr/bin/env node
/**
 * App Store Connect の Analytics レポートを取る。
 *
 * **Admin ロールの API キーが要る。** App Manager では 403 になる（2026-08-27 実測）:
 *   FORBIDDEN_ERROR "The API key in use does not allow this request"
 * 鍵の作り方は docs/リリース手順.md の「iOS の数字を見る」を参照。
 *
 *   node scripts/release/asc-analytics.mjs status   # 要求の一覧（状態を変えない）
 *   node scripts/release/asc-analytics.mjs request  # 一度きりのスナップショットを要求
 *   node scripts/release/asc-analytics.mjs fetch    # 出来ているレポートを落として要約
 *
 * 環境変数で鍵を差し替えられる（既定は submit 用の App Manager キー＝analytics は 403）:
 *   ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const KEY_ID = process.env.ASC_KEY_ID ?? '8C387NYC2T';
const ISSUER = process.env.ASC_ISSUER_ID ?? '5390b406-7460-49b7-8436-f6ce2b281a13';
const KEY_PATH = process.env.ASC_KEY_PATH ?? 'C:/secure/AuthKey_8C387NYC2T.p8';
const APP_ID = process.env.ASC_APP_ID ?? '6800964382';
const OUT = process.env.ASC_OUT_DIR ?? path.join(process.cwd(), 'docs', 'store', 'ios-analytics');

function jwt() {
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' });
  const body = enc({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), {
    key: crypto.createPrivateKey(key),
    dsaEncoding: 'ieee-p1363',
  });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

async function api(p, init = {}) {
  const url = p.startsWith('http') ? p : `https://api.appstoreconnect.apple.com${p}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt()}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* gzip や TSV はここに来ない（別経路で取る） */
  }
  return { status: r.status, json, text };
}

function die(r, what) {
  const e = r.json?.errors?.[0];
  if (e?.code === 'FORBIDDEN_ERROR') {
    console.error(`\n[403] ${what} は、いまの API キーでは読めない。`);
    console.error(
      '  Analytics Reports API は **Admin ロール**の鍵が要る（App Manager では不可）。',
    );
    console.error('  docs/リリース手順.md の「iOS の数字を見る」を参照して鍵を作り、');
    console.error('  ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH を設定して再実行すること。');
    process.exit(2);
  }
  console.error(`\n[${r.status}] ${what} に失敗:`, e ? JSON.stringify(e) : r.text.slice(0, 500));
  process.exit(1);
}

async function listRequests() {
  const r = await api(`/v1/apps/${APP_ID}/analyticsReportRequests?limit=200`);
  if (r.status !== 200) die(r, 'レポート要求の一覧');
  return r.json.data ?? [];
}

const cmd = process.argv[2] ?? 'status';

if (cmd === 'status') {
  const reqs = await listRequests();
  console.log(`レポート要求: ${reqs.length} 件`);
  for (const q of reqs) {
    const a = q.attributes;
    console.log(
      `  - ${q.id}  accessType=${a.accessType}  stoppedDueToInactivity=${a.stoppedDueToInactivity}`,
    );
    const reps = await api(`/v1/analyticsReportRequests/${q.id}/reports?limit=200`);
    for (const rep of reps.json?.data ?? []) {
      console.log(
        `      report ${rep.id}  name=${rep.attributes.name}  category=${rep.attributes.category}`,
      );
    }
  }
  if (reqs.length === 0) console.log('  → `request` で一度きりのスナップショットを要求できる');
} else if (cmd === 'request') {
  const r = await api('/v1/analyticsReportRequests', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'analyticsReportRequests',
        attributes: { accessType: 'ONE_TIME_SNAPSHOT', name: 'daidoko snapshot' },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    }),
  });
  if (r.status >= 300) die(r, 'レポート要求の作成');
  console.log('要求した:', r.json.data.id);
  console.log('**Apple 側の生成に時間がかかる。** しばらくしてから `fetch` を実行すること。');
} else if (cmd === 'fetch') {
  fs.mkdirSync(OUT, { recursive: true });
  const reqs = await listRequests();
  if (reqs.length === 0) {
    console.log('レポート要求が無い。先に `request` を実行すること。');
    process.exit(0);
  }
  let saved = 0;
  for (const q of reqs) {
    const reps = await api(`/v1/analyticsReportRequests/${q.id}/reports?limit=200`);
    for (const rep of reps.json?.data ?? []) {
      const insts = await api(`/v1/analyticsReports/${rep.id}/instances?limit=200`);
      for (const inst of insts.json?.data ?? []) {
        const segs = await api(`/v1/analyticsReportInstances/${inst.id}/segments?limit=200`);
        for (const seg of segs.json?.data ?? []) {
          const url = seg.attributes.url;
          if (!url) continue;
          const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
          const tsv = zlib.gunzipSync(bin).toString('utf8');
          const name =
            `${rep.attributes.name}-${inst.attributes.processingDate}-${seg.id.slice(0, 8)}.tsv`.replace(
              /[^\w.-]/g,
              '_',
            );
          fs.writeFileSync(path.join(OUT, name), tsv);
          console.log(`  保存: ${name}  (${tsv.split('\n').length - 1} 行)`);
          saved += 1;
        }
      }
    }
  }
  console.log(
    saved === 0
      ? '\nまだ生成が終わっていない。時間をおいて再実行すること。'
      : `\n${saved} ファイルを ${OUT} に保存した。`,
  );
} else {
  console.error('使い方: asc-analytics.mjs [status|request|fetch]');
  process.exit(1);
}
