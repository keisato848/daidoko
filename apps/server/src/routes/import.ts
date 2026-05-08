/**
 * POST /api/v1/import/url — URL import route
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { runUrlFetchAgent } from '../agents/url-fetch.agent.js';

const importRouter = new Hono();

const importUrlSchema = z.object({
  url: z
    .string()
    .url('有効なURLを入力してください')
    .max(2048, 'URLが長すぎます')
    .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
      message: 'URLはhttpまたはhttpsで始めてください',
    }),
});

importRouter.post('/url', zValidator('json', importUrlSchema), async (c) => {
  const { url } = c.req.valid('json');
  const result = await runUrlFetchAgent(url);
  // Always return 200 — errors are in the response body (AgentResult pattern)
  return c.json(result);
});

export default importRouter;
