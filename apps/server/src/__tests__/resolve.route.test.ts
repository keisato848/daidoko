/**
 * Integration tests for POST /api/v1/resolve/names
 * vitest + Hono with an injected resolver (no network).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import type { NameResolver } from '../lib/name-resolve.js';
import { setResolveProviderForTesting } from '../routes/resolve.js';

function post(body: unknown) {
  return app.request('/api/v1/resolve/names', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => resetRateLimitForTesting());
afterEach(() => setResolveProviderForTesting(null));

describe('POST /api/v1/resolve/names', () => {
  it('resolves names via the provider', async () => {
    const stub: NameResolver = {
      resolve: async (names) =>
        names.map((n) => ({ name: n, canonical: n === 'とっとごたまご' ? '卵' : '' })),
    };
    setResolveProviderForTesting(stub);

    const res = await post({ names: ['とっとごたまご', 'アプリクーポン'] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: { name: string; canonical: string }[] };
    expect(json.items).toEqual([
      { name: 'とっとごたまご', canonical: '卵' },
      { name: 'アプリクーポン', canonical: '' },
    ]);
  });

  it('rejects an empty names array (validation)', async () => {
    const res = await post({ names: [] });
    expect(res.status).toBe(400);
  });

  it('returns empty items when the resolver throws (no error surfaced)', async () => {
    setResolveProviderForTesting({
      resolve: async () => {
        throw new Error('boom');
      },
    });
    const res = await post({ names: ['x'] });
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });
});
