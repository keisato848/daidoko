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

import importRouter from './routes/import.js';
import inferRouter from './routes/infer.js';
import resolveRouter from './routes/resolve.js';

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
app.route('/api/v1/resolve', resolveRouter);

// ─── 404 / Error ─────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'Not Found' }, 404));
app.onError((err, c) => {
  process.stderr.write(`${String(err)}\n`);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
