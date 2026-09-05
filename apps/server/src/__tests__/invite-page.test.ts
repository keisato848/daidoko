/**
 * 家族共有の招待リンク `/j/:code` の受け皿ページ（docs/クラウド同期設計.md §2-2b）。
 *
 * ここで守るもの:
 * - コードは形だけ検証し、DB は引かない（有効コードの総当たり面を作らない）
 * - noindex・OGP なし（リンクプレビューにコードを載せない）
 * - `daidoko://j/<code>` で開き直せる・ストアへ送れる・手入力用にコードを表示する
 */
import { describe, expect, it } from 'vitest';

process.env['SHARE_DB_PATH'] = ':memory:';

import app from '../app.js';
import { parseInvitePathCode, pickInviteLocale } from '../lib/invite-page.js';

describe('parseInvitePathCode', () => {
  it('小文字・全角・ハイフン混じりを正規化して受ける', () => {
    expect(parseInvitePathCode('abcd-2345')).toBe('ABCD2345');
    expect(parseInvitePathCode('ＡＢＣＤ２３４５')).toBe('ABCD2345');
  });

  it('長さ違い・アルファベット外（0/O/1/I）は弾く', () => {
    expect(parseInvitePathCode('ABCD234')).toBeNull();
    expect(parseInvitePathCode('ABCD23450')).toBeNull();
    expect(parseInvitePathCode('ABCD0OI1')).toBeNull();
    expect(parseInvitePathCode('<script>')).toBeNull();
  });
});

describe('pickInviteLocale', () => {
  it('Accept-Language の先頭が en のときだけ英語', () => {
    expect(pickInviteLocale('en-US,en;q=0.9,ja;q=0.8')).toBe('en');
    expect(pickInviteLocale('ja,en-US;q=0.9')).toBe('ja');
    expect(pickInviteLocale(undefined)).toBe('ja');
  });
});

describe('GET /j/:code', () => {
  it('形の正しいコードならページを返す（noindex・アプリ用リンク・コード表示・OGP なし）', async () => {
    const res = await app.request('/j/abcd2345', { headers: { 'user-agent': 'Mozilla/5.0' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('href="daidoko://j/ABCD2345"');
    expect(html).toContain('>ABCD2345<');
    expect(html).toContain('play.google.com/store/apps/details?id=com.daidoko.app');
    expect(html).not.toContain('og:');
  });

  it('Accept-Language が en なら英語ページ', async () => {
    const res = await app.request('/j/ABCD2345', { headers: { 'accept-language': 'en-US' } });
    const html = await res.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Invitation to family sharing');
  });

  it('形の崩れたコードは 404（DB は見ない）', async () => {
    const res = await app.request('/j/not-a-code');
    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('AASA の paths に /j/* が含まれる（Universal Links でアプリが開く）', async () => {
    const saved = process.env['APPLE_TEAM_ID'];
    process.env['APPLE_TEAM_ID'] = 'ABCDE12345';
    const aasa = await app.request('/.well-known/apple-app-site-association');
    const body = (await aasa.json()) as { applinks: { details: { paths: string[] }[] } };
    expect(body.applinks.details[0]?.paths).toContain('/j/*');
    if (saved === undefined) delete process.env['APPLE_TEAM_ID'];
    else process.env['APPLE_TEAM_ID'] = saved;
  });
});
