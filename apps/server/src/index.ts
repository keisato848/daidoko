/**
 * だいどこ API Server — Hono on Node.js
 * v1.0: URL import endpoint only (no auth yet)
 *
 * app is exported separately so tests can import without starting the server.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import importRouter from './routes/import.js';
import inferRouter from './routes/infer.js';

export const app = new Hono();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ['http://localhost:8081', 'http://localhost:8082', 'http://localhost:19006'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (c) => c.json({ name: 'だいどこ API', version: '1.0.0', status: 'ok' }));
app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }));

app.route('/api/v1/import', importRouter);
app.route('/api/v1/infer', inferRouter);

// ─── 404 / Error ─────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'Not Found' }, 404));
app.onError((err, c) => {
  process.stderr.write(`${String(err)}\n`);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// ─── Start (only when run directly, not imported by tests) ───────────────────

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const { serve } = await import('@hono/node-server');
  const port = Number(process.env['PORT'] ?? 3000);
  serve({ fetch: app.fetch, port }, () => {
    process.stdout.write(`🍳 だいどこ API サーバー起動 → http://localhost:${port}\n`);
  });
}

export default app;
