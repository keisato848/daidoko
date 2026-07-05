/**
 * Google Play androidpublisher API の共通ヘルパー。
 * update-play-listing.mjs / update-play-screenshots.mjs で共有する。
 *
 * 認証: サービスアカウント JSON（既定 C:/secure/play-service-account.json、
 * 環境変数 PLAY_SERVICE_ACCOUNT_KEY で上書き可）。キーの値は一切出力しない。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

export const PACKAGE = 'com.daidoko.app';
export const API_BASE = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
export const UPLOAD_BASE = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;

const KEY_PATH = process.env.PLAY_SERVICE_ACCOUNT_KEY ?? 'C:/secure/play-service-account.json';

/** サービスアカウント JWT で androidpublisher スコープのアクセストークンを得る */
export async function getAccessToken() {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = crypto
    .sign('RSA-SHA256', Buffer.from(unsigned), key.private_key)
    .toString('base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
  });
  const tok = await res.json();
  if (!tok.access_token)
    throw new Error(`token failed: ${res.status} ${JSON.stringify(tok).slice(0, 200)}`);
  return tok.access_token;
}

/** edits フローの薄いクライアント */
export function createEditsClient(accessToken) {
  const jsonHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  async function request(url, init = {}) {
    const res = await fetch(url, { ...init, headers: { ...jsonHeaders, ...(init.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        `${init.method ?? 'GET'} ${url} -> ${res.status} ${JSON.stringify(body).slice(0, 400)}`,
      );
    return body;
  }

  return {
    insert: () => request(`${API_BASE}/edits`, { method: 'POST', body: '{}' }),
    commit: (editId) => request(`${API_BASE}/edits/${editId}:commit`, { method: 'POST' }),
    getListing: (editId, lang) => request(`${API_BASE}/edits/${editId}/listings/${lang}`),
    updateListing: (editId, lang, body) =>
      request(`${API_BASE}/edits/${editId}/listings/${lang}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteAllImages: (editId, lang, imageType) =>
      request(`${API_BASE}/edits/${editId}/listings/${lang}/${imageType}`, { method: 'DELETE' }),
    listImages: (editId, lang, imageType) =>
      request(`${API_BASE}/edits/${editId}/listings/${lang}/${imageType}`),
    uploadImage: async (editId, lang, imageType, filePath) => {
      const data = fs.readFileSync(filePath);
      const res = await fetch(
        `${UPLOAD_BASE}/edits/${editId}/listings/${lang}/${imageType}?uploadType=media`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png' },
          body: data,
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          `upload ${filePath} -> ${res.status} ${JSON.stringify(body).slice(0, 400)}`,
        );
      return body;
    },
  };
}
