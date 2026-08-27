#!/usr/bin/env node
/**
 * App Store Connect の Analytics レポートを取る。
 *
 * **Admin ロールの API キーが要る。** App Manager では 403 になる（2026-08-27 実測）:
 *   FORBIDDEN_ERROR "The API key in use does not allow this request"
 * 鍵の作り方は docs/リリース手順.md §3d-1a。
 *
 *   node scripts/release/asc-analytics.mjs status   # 要求と生成状況（状態を変えない）
 *   node scripts/release/asc-analytics.mjs request  # レポートを要求（既定は一度きりのスナップショット）
 *   node scripts/release/asc-analytics.mjs fetch    # 出来ているものを落とす
 *
 * 環境変数:
 *   ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH  鍵（既定は submit 用＝analytics は 403）
 *   ASC_ACCESS_TYPE=ONGOING                    request で継続収集を要求する
 *   ASC_ALL=1                                  注目レポート以外も対象にする
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

/**
 * 見たいレポート。1 要求あたり 150 本以上あり、大半は FRAMEWORK_USAGE
 * （AirPlay・CarPlay・Safari 拡張…）でこのアプリには無関係。既定では無視する。
 */
const WANTED = new Set([
  'App Store Discovery and Engagement Standard', // 表示回数・製品ページ表示・転換
  'App Downloads Standard', // ダウンロード
  'App Store Installation and Deletion Standard', // インストールと削除
  'App Sessions Standard', // セッション（定着）
]);

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
    /* 本体が JSON でないことがある */
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
    console.error('  docs/リリース手順.md §3d-1a を見て鍵を作り、');
    console.error('  ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH を設定して再実行すること。');
    process.exit(2);
  }
  console.error(`\n[${r.status}] ${what} に失敗:`, e ? JSON.stringify(e) : r.text.slice(0, 500));
  process.exit(1);
}

/** reports は 1 要求あたり 150 本超あり、ページングしないと取りこぼす */
async function allReports(requestId) {
  const out = [];
  let next = `/v1/analyticsReportRequests/${requestId}/reports?limit=200`;
  while (next) {
    const r = await api(next);
    if (r.status !== 200) die(r, 'レポート一覧');
    out.push(...(r.json.data ?? []));
    next = r.json.links?.next ?? null;
  }
  return out;
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
    console.log(`\n  ▸ ${q.attributes.accessType}  (${q.id})`);
    const reps = await allReports(q.id);
    const shown = process.env.ASC_ALL ? reps : reps.filter((x) => WANTED.has(x.attributes.name));
    console.log(
      `    レポート ${reps.length} 本（注目 ${shown.length} 本。全部見るなら ASC_ALL=1）`,
    );
    for (const rep of shown) {
      const inst = await api(`/v1/analyticsReports/${rep.id}/instances?limit=1`);
      const ready = (inst.json?.data?.length ?? 0) > 0;
      console.log(`     ${ready ? '生成済み  ' : '**生成待ち**'} ${rep.attributes.name}`);
    }
  }
  if (reqs.length === 0) console.log('  → `request` で要求できる');
} else if (cmd === 'request') {
  const accessType = process.env.ASC_ACCESS_TYPE ?? 'ONE_TIME_SNAPSHOT';
  const r = await api('/v1/analyticsReportRequests', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'analyticsReportRequests',
        // `name` は存在しない属性（409 ENTITY_ERROR.ATTRIBUTE.UNKNOWN。2026-08-27 実測）
        attributes: { accessType },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    }),
  });
  if (r.status >= 300) die(r, 'レポート要求の作成');
  console.log(`要求した (${accessType}):`, r.json.data.id);
  console.log(
    '**Apple 側の生成に時間がかかる。** 当日中には出ないことがある。翌日 `fetch` すること。',
  );
} else if (cmd === 'fetch') {
  fs.mkdirSync(OUT, { recursive: true });
  const reqs = await listRequests();
  if (reqs.length === 0) {
    console.log('レポート要求が無い。先に `request` を実行すること。');
    process.exit(0);
  }
  let saved = 0;
  let pending = 0;
  for (const q of reqs) {
    for (const rep of await allReports(q.id)) {
      if (!process.env.ASC_ALL && !WANTED.has(rep.attributes.name)) continue;
      const insts = await api(`/v1/analyticsReports/${rep.id}/instances?limit=200`);
      const list = insts.json?.data ?? [];
      if (list.length === 0) {
        console.log(`  生成待ち: ${rep.attributes.name}`);
        pending += 1;
        continue;
      }
      for (const inst of list) {
        const segs = await api(`/v1/analyticsReportInstances/${inst.id}/segments?limit=200`);
        for (const seg of segs.json?.data ?? []) {
          if (!seg.attributes.url) continue;
          const bin = Buffer.from(await (await fetch(seg.attributes.url)).arrayBuffer());
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
      ? `\n保存できたものは無い（生成待ち ${pending} 本）。翌日に再実行すること。`
      : `\n${saved} ファイルを ${OUT} に保存した。（生成待ち ${pending} 本）`,
  );
} else {
  console.error('使い方: asc-analytics.mjs [status|request|fetch]');
  process.exit(1);
}
