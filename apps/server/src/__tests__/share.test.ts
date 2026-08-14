/**
 * Web 共有（レシピ共有リンク）のルートテスト。docs/Web共有設計.md。
 *
 * ここで守るもの:
 * - attested なしでは公開できない（権利面の証跡）
 * - ページは noindex かつ全フィールドが HTML エスケープされる（XSS）
 * - 取り消しはトークン必須・取り消し後は 404（存在も漏らさない）
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env['SHARE_DB_PATH'] = ':memory:';

import app from '../app.js';
import { resetShareDbForTesting } from '../lib/share-store.js';
import { resetShareRateLimitForTesting } from '../routes/share.js';

// 1x1 JPEG（最小のダミー写真）
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

function basePayload() {
  return {
    attested: true,
    locale: 'ja',
    title: 'ふわとろ卵かけごはん',
    servings: 2,
    cookTimeMin: 5,
    description: '休日の朝ごはん',
    ingredients: [
      { name: '卵', amount: '2個' },
      { name: 'ごはん', amount: '2杯', groupLabel: '主食' },
    ],
    steps: [{ body: '卵を溶く' }, { body: 'ごはんにかける' }],
    tags: ['朝ごはん'],
  };
}

async function publish(payload: unknown): Promise<Response> {
  return app.request('/api/v1/share/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('Web 共有', () => {
  beforeAll(() => {
    resetShareDbForTesting();
  });
  beforeEach(() => {
    resetShareRateLimitForTesting();
  });

  it('公開 → slug / url / deleteToken が返る', async () => {
    const res = await publish(basePayload());
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      slug: string;
      url: string;
      deleteToken: string;
    };
    expect(json.ok).toBe(true);
    expect(json.slug.length).toBeGreaterThanOrEqual(12);
    expect(json.url).toContain(`/r/${json.slug}`);
    expect(json.deleteToken.length).toBeGreaterThanOrEqual(24);
  });

  it('attested なしでは公開できない（権利面の証跡）', async () => {
    const res = await publish({ ...basePayload(), attested: false });
    expect(res.status).toBe(400);
  });

  it('ページ: 内容が表示され、noindex が付く', async () => {
    const { slug } = (await (await publish(basePayload())).json()) as { slug: string };
    const res = await app.request(`/r/${slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('ふわとろ卵かけごはん');
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('卵を溶く');
    expect(html).toContain('play.google.com'); // アプリ導線
  });

  it('ページ: ユーザー入力は HTML エスケープされる（XSS）', async () => {
    const { slug } = (await (
      await publish({
        ...basePayload(),
        title: '<script>alert(1)</script>',
        steps: [{ body: '<img src=x onerror=alert(1)>' }],
      })
    ).json()) as { slug: string };
    const html = await (await app.request(`/r/${slug}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('写真: 公開時に同送 → 写真 URL が OGP に載り、取得できる', async () => {
    const { slug } = (await (
      await publish({ ...basePayload(), photoBase64: TINY_JPEG_BASE64, photoMime: 'image/jpeg' })
    ).json()) as { slug: string };
    const page = await (await app.request(`/r/${slug}`)).text();
    expect(page).toContain(`og:image`);
    const res = await app.request(`/r/${slug}/photo`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
  });

  it('取り消し: 誤トークンは 403・正トークンで取り消し → ページも写真も 404', async () => {
    const { slug, deleteToken } = (await (
      await publish({ ...basePayload(), photoBase64: TINY_JPEG_BASE64, photoMime: 'image/jpeg' })
    ).json()) as { slug: string; deleteToken: string };

    const bad = await app.request(`/api/v1/share/recipes/${slug}`, {
      method: 'DELETE',
      headers: { 'x-share-delete-token': 'wrong-token' },
    });
    expect(bad.status).toBe(403);

    const ok = await app.request(`/api/v1/share/recipes/${slug}`, {
      method: 'DELETE',
      headers: { 'x-share-delete-token': deleteToken },
    });
    expect(ok.status).toBe(200);

    expect((await app.request(`/r/${slug}`)).status).toBe(404);
    expect((await app.request(`/r/${slug}/photo`)).status).toBe(404);
    // 取り消し済みへの再取り消しは 404（存在を漏らさない）
    const again = await app.request(`/api/v1/share/recipes/${slug}`, {
      method: 'DELETE',
      headers: { 'x-share-delete-token': deleteToken },
    });
    expect(again.status).toBe(404);
  });

  it('存在しない slug のページは 404', async () => {
    expect((await app.request('/r/nonexistent1')).status).toBe(404);
  });

  it('レート制限: クライアント別の上限を超えると 429', async () => {
    process.env['SHARE_DAILY_LIMIT'] = '2';
    try {
      expect((await publish(basePayload())).status).toBe(200);
      expect((await publish(basePayload())).status).toBe(200);
      expect((await publish(basePayload())).status).toBe(429);
    } finally {
      delete process.env['SHARE_DAILY_LIMIT'];
    }
  });

  describe('レシピ帖（S2）', () => {
    function bookPayload() {
      return {
        attested: true,
        locale: 'ja',
        title: 'わが家の定番',
        description: '家族のいつもの味',
        recipes: [
          { ...basePayload(), title: '肉じゃが', attested: undefined, locale: undefined },
          {
            title: '卵焼き',
            ingredients: [{ name: '卵', amount: '3個' }],
            steps: [{ body: '焼く' }],
            tags: [],
            photoBase64: TINY_JPEG_BASE64,
            photoMime: 'image/jpeg',
          },
        ],
      };
    }

    async function publishBook(payload: unknown): Promise<Response> {
      return app.request('/api/v1/share/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    it('公開 → /b の URL が返り、ページに目次と全レシピが載る', async () => {
      const res = await publishBook(bookPayload());
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; slug: string; url: string };
      expect(json.url).toContain(`/b/${json.slug}`);

      const page = await app.request(`/b/${json.slug}`);
      expect(page.status).toBe(200);
      expect(page.headers.get('x-robots-tag')).toBe('noindex');
      const html = await page.text();
      expect(html).toContain('わが家の定番');
      expect(html).toContain('収録レシピ'); // 目次
      expect(html).toContain('肉じゃが');
      expect(html).toContain('卵焼き');
      expect(html).toContain('name="robots" content="noindex"');
    });

    it('attested なしでは公開できない', async () => {
      expect((await publishBook({ ...bookPayload(), attested: false })).status).toBe(400);
    });

    it('レシピ 0 件の帖は公開できない', async () => {
      expect((await publishBook({ ...bookPayload(), recipes: [] })).status).toBe(400);
    });

    it('写真: 位置つき URL で取得でき、og:image は最初の写真を指す', async () => {
      const { slug } = (await (await publishBook(bookPayload())).json()) as { slug: string };
      const html = await (await app.request(`/b/${slug}`)).text();
      // 1 冊目（肉じゃが）は写真なし → og:image は 2 冊目（index 1）
      expect(html).toContain(`/b/${slug}/photo/1`);
      const photo = await app.request(`/b/${slug}/photo/1`);
      expect(photo.status).toBe(200);
      expect(photo.headers.get('content-type')).toBe('image/jpeg');
      expect((await app.request(`/b/${slug}/photo/0`)).status).toBe(404); // 写真なしの位置
      expect((await app.request(`/b/${slug}/photo/99`)).status).toBe(404);
    });

    it('取り消し: 誤トークン 403 → 正トークンで帖ごと 404', async () => {
      const { slug, deleteToken } = (await (await publishBook(bookPayload())).json()) as {
        slug: string;
        deleteToken: string;
      };
      expect(
        (
          await app.request(`/api/v1/share/books/${slug}`, {
            method: 'DELETE',
            headers: { 'x-share-delete-token': 'wrong' },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request(`/api/v1/share/books/${slug}`, {
            method: 'DELETE',
            headers: { 'x-share-delete-token': deleteToken },
          })
        ).status,
      ).toBe(200);
      expect((await app.request(`/b/${slug}`)).status).toBe(404);
      expect((await app.request(`/b/${slug}/photo/1`)).status).toBe(404);
    });

    it('帖のタイトル・レシピ名も HTML エスケープされる', async () => {
      const payload = bookPayload();
      payload.title = '<script>x</script>';
      const first = payload.recipes[0];
      if (first) first.title = '<img src=x>';
      const { slug } = (await (await publishBook(payload)).json()) as { slug: string };
      const html = await (await app.request(`/b/${slug}`)).text();
      expect(html).not.toContain('<script>x</script>');
      expect(html).not.toContain('<img src=x>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  it('export: トークン未設定なら 404・設定時は一致ヘッダで全件', async () => {
    expect((await app.request('/api/v1/share/export')).status).toBe(404);
    process.env['SHARE_EXPORT_TOKEN'] = 'test-export-token';
    try {
      const noHeader = await app.request('/api/v1/share/export');
      expect(noHeader.status).toBe(404);
      const res = await app.request('/api/v1/share/export', {
        headers: { 'x-export-token': 'test-export-token' },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; shares: unknown[] };
      expect(json.ok).toBe(true);
      expect(json.shares.length).toBeGreaterThan(0);
    } finally {
      delete process.env['SHARE_EXPORT_TOKEN'];
    }
  });
});

// ── S4: 帖の更新（リンク不変）・パスコード・有効期限 ─────────────────────────
import { createBookShare, resetPasscodeFailsForTesting } from '../lib/share-store.js';

describe('レシピ帖 S4', () => {
  beforeEach(() => {
    resetShareRateLimitForTesting();
    resetPasscodeFailsForTesting();
  });

  function s4BookPayload() {
    return {
      attested: true,
      locale: 'ja',
      title: 'わが家の定番',
      recipes: [
        {
          title: '肉じゃが',
          ingredients: [{ name: 'じゃがいも', amount: '3個' }],
          steps: [{ body: '煮る' }],
          tags: [],
          photoBase64: TINY_JPEG_BASE64,
          photoMime: 'image/jpeg',
        },
      ],
    };
  }

  async function publishS4Book(payload: unknown): Promise<{
    slug: string;
    url: string;
    deleteToken: string;
    expiresAt: string | null;
  }> {
    const res = await app.request('/api/v1/share/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      slug: string;
      url: string;
      deleteToken: string;
      expiresAt: string | null;
    };
  }

  async function patchBook(slug: string, token: string, payload: unknown): Promise<Response> {
    return app.request(`/api/v1/share/books/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-share-delete-token': token },
      body: JSON.stringify(payload),
    });
  }

  it('PATCH: slug を変えずに題名・収録レシピを差し替えられる', async () => {
    const { slug, deleteToken } = await publishS4Book(s4BookPayload());
    const updated = {
      ...s4BookPayload(),
      title: '改訂版レシピ帖',
      recipes: [
        {
          title: '追加した唐揚げ',
          ingredients: [{ name: '鶏もも', amount: '300g' }],
          steps: [{ body: '揚げる' }],
          tags: [],
        },
      ],
    };
    const res = await patchBook(slug, deleteToken, updated);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; slug: string; url: string };
    expect(json.slug).toBe(slug);
    const html = await (await app.request(`/b/${slug}`)).text();
    expect(html).toContain('改訂版レシピ帖');
    expect(html).toContain('追加した唐揚げ');
    expect(html).not.toContain('肉じゃが');
  });

  it('PATCH: トークン不一致は 403・存在しない slug は 404', async () => {
    const { slug } = await publishS4Book(s4BookPayload());
    expect((await patchBook(slug, 'wrong-token', s4BookPayload())).status).toBe(403);
    expect((await patchBook('nosuchslug12', 'token', s4BookPayload())).status).toBe(404);
  });

  it('パスコード: 未認証はページ 401（中身もタイトルも出ない）・写真も 404', async () => {
    const { slug } = await publishS4Book({ ...s4BookPayload(), passcode: '1234' });
    const page = await app.request(`/b/${slug}`);
    expect(page.status).toBe(401);
    const html = await page.text();
    expect(html).not.toContain('わが家の定番');
    expect(html).not.toContain('肉じゃが');
    expect(html).toContain('パスコード');
    expect((await app.request(`/b/${slug}/photo/0`)).status).toBe(404);
  });

  it('パスコード: 正解で Cookie が発行され、ページも写真も読める', async () => {
    const { slug } = await publishS4Book({ ...s4BookPayload(), passcode: '1234' });
    const wrong = await app.request(`/b/${slug}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'passcode=0000',
    });
    expect(wrong.status).toBe(401);

    const ok = await app.request(`/b/${slug}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'passcode=1234',
    });
    expect(ok.status).toBe(303);
    const setCookie = ok.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`daidoko_book_${slug}=`);
    const cookie = setCookie.split(';')[0] ?? '';

    const page = await app.request(`/b/${slug}`, { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('わが家の定番');
    expect((await app.request(`/b/${slug}/photo/0`, { headers: { cookie } })).status).toBe(200);
  });

  it('パスコード: 5 回失敗でロックされ、正解でも通らない', async () => {
    const { slug } = await publishS4Book({ ...s4BookPayload(), passcode: '1234' });
    for (let i = 0; i < 5; i++) {
      await app.request(`/b/${slug}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'passcode=9999',
      });
    }
    const locked = await app.request(`/b/${slug}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'passcode=1234',
    });
    expect(locked.status).toBe(401);
    expect(await locked.text()).toContain('試行回数');
  });

  it('有効期限: 期限を過ぎた帖は 404（存在を漏らさない）', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const { slug } = createBookShare(
      {
        locale: 'ja',
        title: '期限切れ帖',
        recipes: [{ title: 'a', ingredients: [{ name: 'x' }], steps: [{ body: 'y' }], tags: [] }],
      },
      { expiresAt: past },
    );
    expect((await app.request(`/b/${slug}`)).status).toBe(404);
  });

  it('有効期限: expiresInDays を渡すと expiresAt が返り、PATCH null で解除できる', async () => {
    const { slug, deleteToken, expiresAt } = await publishS4Book({
      ...s4BookPayload(),
      expiresInDays: 7,
    });
    expect(expiresAt).not.toBeNull();
    const res = await patchBook(slug, deleteToken, { ...s4BookPayload(), expiresInDays: null });
    const json = (await res.json()) as { expiresAt: string | null };
    expect(json.expiresAt).toBeNull();
    expect((await app.request(`/b/${slug}`)).status).toBe(200);
  });
});

// ── 「アプリで保存」の遷移先（iOS 公開後に env で切り替える）─────────────────
import { storeUrlForUserAgent } from '../lib/share-page.js';

describe('storeUrlForUserAgent', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SH-RM19s)';

  it('SHARE_APP_STORE_URL 未設定なら iOS でも Play へ送る（公開前の App Store は 404 のため）', () => {
    delete process.env['SHARE_APP_STORE_URL'];
    expect(storeUrlForUserAgent(IPHONE)).toContain('play.google.com');
    expect(storeUrlForUserAgent(ANDROID)).toContain('play.google.com');
  });

  it('設定後は iOS だけ App Store へ送る', () => {
    process.env['SHARE_APP_STORE_URL'] = 'https://apps.apple.com/app/id6800964382';
    try {
      expect(storeUrlForUserAgent(IPHONE)).toContain('apps.apple.com');
      expect(storeUrlForUserAgent(ANDROID)).toContain('play.google.com');
      expect(storeUrlForUserAgent(undefined)).toContain('play.google.com');
    } finally {
      delete process.env['SHARE_APP_STORE_URL'];
    }
  });
});
