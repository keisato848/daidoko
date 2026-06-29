/**
 * だいどこ API Server — Node.js bootstrap.
 *
 * The Hono app lives in app.ts. This file only starts the HTTP server when run
 * directly (local dev / Railway), not when imported by tests or the Lambda entry.
 */
import { app } from './app.js';

export { app };

// ─── Start (only when run directly, not imported by tests / Lambda) ──────────

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const { serve } = await import('@hono/node-server');
  const port = Number(process.env['PORT'] ?? 3000);
  serve({ fetch: app.fetch, port }, () => {
    process.stdout.write(`🍳 だいどこ API サーバー起動 → http://localhost:${port}\n`);
  });
}

export default app;
