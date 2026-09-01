/**
 * Hono app construction (middleware + routes).
 *
 * Kept separate from the Node bootstrap (index.ts) and the AWS Lambda entry
 * (lambda.ts) so it can be imported with no side effects — no HTTP server
 * start and no top-level await — which keeps the Lambda bundle clean.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import gardenRouter from './routes/garden.js';
import importRouter from './routes/import.js';
import inferRouter from './routes/infer.js';
import { invitePageRouter } from './routes/invite.js';
import reportRouter from './routes/report.js';
import resolveRouter from './routes/resolve.js';
import syncRouter from './routes/sync.js';
import { bookPageRouter, shareApiRouter, sharePageRouter } from './routes/share.js';

export const app = new Hono();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ['http://localhost:8081', 'http://localhost:8082', 'http://localhost:19006'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-share-delete-token'],
  }),
);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (c) => c.json({ name: 'だいどこ API', version: '1.0.0', status: 'ok' }));
app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }));

app.route('/api/v1/import', importRouter);
app.route('/api/v1/infer', inferRouter);
app.route('/api/v1/resolve', resolveRouter);
// さいえん手帳（家庭菜園アプリ）の相乗りルート。プロンプトはレシピ系と独立
app.route('/api/v1/garden', gardenRouter);
// クラウド同期（S0: グループ・端末・認証）。DATABASE_URL が無い環境では全て 503
app.route('/api/v1/sync', syncRouter);
// Web 共有（レシピ共有リンク）。/r/* と /b/* は人間が見る HTML ページ
app.route('/api/v1/share', shareApiRouter);
app.route('/r', sharePageRouter);
app.route('/b', bookPageRouter);
// 家族共有の招待リンク（/j/:code）。アプリ未導入・App Links 未検証のときだけ人が見る
app.route('/j', invitePageRouter);
// アプリ内報告（docs/レシピ表紙AI生成設計.md §6）
app.route('/api/v1/report', reportRouter);

// ── App Links / Universal Links（#198） ───────────────────────────────────────
// 共有リンク（/r/:slug・/b/:slug）と招待リンク（/j/:code）をインストール済みのアプリで開くための検証ファイル。
// 指紋・Team ID は環境変数（Play App Signing の鍵は Play Console にしか無い）。
// 未設定なら 404 にして、OS 側は従来どおりブラウザで開く（何も壊れない）。
app.get('/.well-known/assetlinks.json', (c) => {
  const raw = process.env['APP_LINKS_SHA256_FINGERPRINTS'] ?? '';
  const fingerprints = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  if (fingerprints.length === 0) return c.notFound();
  return c.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.daidoko.app',
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
});

app.get('/.well-known/apple-app-site-association', (c) => {
  const teamId = process.env['APPLE_TEAM_ID']?.trim();
  if (!teamId) return c.notFound();
  // Content-Type は application/json 固定（拡張子が無いので明示する）
  return c.json({
    applinks: {
      apps: [],
      details: [{ appID: `${teamId}.com.daidoko.app`, paths: ['/r/*', '/b/*', '/j/*'] }],
    },
  });
});

// ─── 404 / Error ─────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'Not Found' }, 404));
app.onError((err, c) => {
  process.stderr.write(`${String(err)}\n`);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
