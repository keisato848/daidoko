/**
 * 同期の認証まわりの純関数（lib/sync-auth）。
 * 招待コードの形・期限・シークレット照合・Authorization ヘッダの分解を固定する。
 */
import { describe, expect, it } from 'vitest';

import {
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  generateDeviceSecret,
  generateId,
  generateInviteCode,
  hashSecret,
  inviteExpiresAt,
  isInviteExpired,
  normalizeInviteCode,
  parseAuthHeader,
  verifySecretHash,
} from '../lib/sync-auth.js';

describe('招待コード', () => {
  it('8 文字・紛らわしい字を含まない字母から作る', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      for (const ch of code) expect(INVITE_ALPHABET).toContain(ch);
    }
  });

  it('字母に I/O/0/1 が無い（読み間違い・打ち間違いの元）', () => {
    for (const ch of 'IO01') expect(INVITE_ALPHABET).not.toContain(ch);
  });

  it('入力ゆれを吸収する（空白・ハイフン・小文字）', () => {
    expect(normalizeInviteCode(' ab-cd ef2 ')).toBe('ABCDEF2');
  });

  it('期限は境界ちょうどで切れる', () => {
    const now = new Date('2026-08-21T12:00:00Z');
    const expires = inviteExpiresAt(now);
    expect(isInviteExpired(expires, new Date(expires.getTime() - 1))).toBe(false);
    expect(isInviteExpired(expires, expires)).toBe(true);
  });
});

describe('端末クレデンシャル', () => {
  it('ID・シークレットは base64url（Authorization の区切り "." を含まない）', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateId()).not.toContain('.');
      expect(generateDeviceSecret()).not.toContain('.');
    }
  });

  it('正しいシークレットだけが通る', () => {
    const secret = generateDeviceSecret();
    const stored = hashSecret(secret);
    expect(verifySecretHash(secret, stored)).toBe(true);
    expect(verifySecretHash(generateDeviceSecret(), stored)).toBe(false);
  });

  it('保存側が壊れた値でも throw せず false', () => {
    expect(verifySecretHash('anything', 'not-hex-garbage')).toBe(false);
    expect(verifySecretHash('anything', '')).toBe(false);
  });
});

describe('parseAuthHeader', () => {
  it('Bearer <id>.<secret> を分解する（大文字小文字は不問）', () => {
    expect(parseAuthHeader('Bearer dev123.sec456')).toEqual({
      deviceId: 'dev123',
      secret: 'sec456',
    });
    expect(parseAuthHeader('bearer a.b')).toEqual({ deviceId: 'a', secret: 'b' });
  });

  it('最初の "." で切る（後半に "." が混ざっても壊れない）', () => {
    expect(parseAuthHeader('Bearer a.b.c')).toEqual({ deviceId: 'a', secret: 'b.c' });
  });

  it('形式が違えば null', () => {
    expect(parseAuthHeader(undefined)).toBeNull();
    expect(parseAuthHeader('')).toBeNull();
    expect(parseAuthHeader('Bearer no-dot')).toBeNull();
    expect(parseAuthHeader('Bearer .secretonly')).toBeNull();
    expect(parseAuthHeader('Bearer idonly.')).toBeNull();
    expect(parseAuthHeader('Basic a.b')).toBeNull();
  });
});
