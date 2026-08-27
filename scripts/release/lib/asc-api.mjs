/**
 * App Store Connect API の共通部分（認証と薄い fetch ラッパ）。
 *
 * Play 側の `play-api.mjs` に相当する。鍵は `apps/mobile/eas.json` の
 * `submit.production.ios` から読む（`ascApiKeyPath` / `ascApiKeyId` / `ascApiKeyIssuerId` /
 * `ascAppId`）。**`.p8` はリポジトリ外**（`C:\secure\`）でコミット禁止・再ダウンロード不可。
 *
 * **撮影は macOS が要るが、アップロードは Windows からできる**（`docs/store/app-store/SUBMISSION.md`）。
 *
 * 注意: **掲載文とスクショは `appStoreVersion` にぶら下がる。**
 * `READY_FOR_SALE` のバージョンは編集できない（Apple が 409 STATE_ERROR を返す）ので、
 * 変更するには編集可能なバージョン（`PREPARE_FOR_SUBMISSION`）が要る。
 * 審査なしで変えられるのは `promotionalText` だけ。
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const API_BASE = 'https://api.appstoreconnect.apple.com';

export function readAscConfig() {
  const eas = JSON.parse(readFileSync(path.join(ROOT, 'apps/mobile/eas.json'), 'utf8'));
  const cfg = eas?.submit?.production?.ios;
  if (!cfg?.ascApiKeyPath || !cfg?.ascApiKeyId || !cfg?.ascApiKeyIssuerId || !cfg?.ascAppId) {
    throw new Error(
      'apps/mobile/eas.json の submit.production.ios に ascApiKeyPath / ascApiKeyId / ascApiKeyIssuerId / ascAppId が要ります',
    );
  }
  return cfg;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * ES256 の JWT を作る。
 *
 * Node の `sign` は **DER（可変長）**で返すが、JOSE は **r,s 固定 32 バイト**を求める。
 * ここを変換し忘れると Apple が 401 を返す（見た目は「鍵が違う」に見えるので気づきにくい）。
 */
export function createAscToken(cfg = readAscConfig(), ttlSec = 600) {
  const privateKey = readFileSync(cfg.ascApiKeyPath, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.ascApiKeyId, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: cfg.ascApiKeyIssuerId,
      iat: now,
      exp: now + ttlSec,
      aud: 'appstoreconnect-v1',
    }),
  );
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const der = signer.sign(privateKey);

  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f;
  const readInt = () => {
    const len = der[offset + 1];
    const start = offset + 2;
    let bytes = der.subarray(start, start + len);
    offset = start + len;
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.subarray(1);
    return Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]);
  };
  const r = readInt();
  const s = readInt();
  return `${header}.${payload}.${Buffer.concat([r, s]).toString('base64url')}`;
}

/** 認証つきの薄い fetch。JSON を返し、失敗は本文つきで投げる。 */
export function createAscClient(token = createAscToken()) {
  const headers = { Authorization: `Bearer ${token}` };

  async function request(method, urlPath, body) {
    const url = urlPath.startsWith('http') ? urlPath : `${API_BASE}${urlPath}`;
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${urlPath} → ${res.status}\n${text.slice(0, 800)}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    token,
    get: (p) => request('GET', p),
    post: (p, body) => request('POST', p, body),
    patch: (p, body) => request('PATCH', p, body),
    delete: (p) => request('DELETE', p),
    /** ページングを畳んで data を全部返す。 */
    async getAll(p) {
      const out = [];
      let next = p;
      while (next) {
        const page = await request('GET', next);
        out.push(...(page.data ?? []));
        next = page.links?.next ?? null;
      }
      return out;
    },
  };
}

/**
 * 編集できるバージョンを 1 つ返す。無ければ null。
 *
 * `READY_FOR_SALE` などは編集できないので、掲載文・スクショを変えるなら
 * ここが null でないことが前提になる。
 */
export async function findEditableVersion(client, appId) {
  const versions = await client.getAll(
    `/v1/apps/${appId}/appStoreVersions?limit=20&fields[appStoreVersions]=versionString,appStoreState,platform`,
  );
  const editable = new Set([
    'PREPARE_FOR_SUBMISSION',
    'DEVELOPER_REJECTED',
    'REJECTED',
    'METADATA_REJECTED',
    'INVALID_BINARY',
    'WAITING_FOR_REVIEW',
  ]);
  return (
    versions.find(
      (v) => v.attributes.platform === 'IOS' && editable.has(v.attributes.appStoreState),
    ) ?? null
  );
}

/** 掲載中も含めた全バージョンを新しい順で返す（状態の確認用・読み取りのみ）。 */
export async function listVersions(client, appId) {
  return client.getAll(
    `/v1/apps/${appId}/appStoreVersions?limit=20&fields[appStoreVersions]=versionString,appStoreState,platform,createdDate`,
  );
}
