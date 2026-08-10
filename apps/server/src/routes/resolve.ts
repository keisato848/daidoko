/**
 * POST /api/v1/resolve/names — messy ingredient names → canonical names (text LLM).
 * Returns `{ items: [{ name, canonical }] }`. On rate-limit / config error /
 * failure it returns `{ items: [] }` (200) so the client silently falls back to
 * substring matching — never an error.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { GeminiNameResolver, ResolveConfigError, type NameResolver } from '../lib/name-resolve.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { parseOutputLocale } from '../lib/output-locale.js';

const resolveRouter = new Hono();

const namesSchema = z.object({
  names: z.array(z.string().min(1).max(80)).min(1).max(50),
  /** 端末の言語。正規化後の食材名の言語を決める。省略時は ja。 */
  locale: z.enum(['ja', 'en']).optional(),
});

let providerOverride: NameResolver | null = null;

export function setResolveProviderForTesting(provider: NameResolver | null): void {
  providerOverride = provider;
}

function resolveProvider(): NameResolver {
  return providerOverride ?? new GeminiNameResolver();
}

resolveRouter.post('/names', zValidator('json', namesSchema), async (c) => {
  const clientId =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'anonymous';
  if (!checkRateLimit(clientId).allowed) {
    return c.json({ items: [] });
  }

  const { names, locale } = c.req.valid('json');

  let provider: NameResolver;
  try {
    provider = resolveProvider();
  } catch (err) {
    if (err instanceof ResolveConfigError) return c.json({ items: [] });
    throw err;
  }

  try {
    const items = await provider.resolve(names, parseOutputLocale(locale));
    return c.json({ items });
  } catch {
    return c.json({ items: [] });
  }
});

export default resolveRouter;
