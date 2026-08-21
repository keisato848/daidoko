/**
 * 同期のアカウントレス認証まわりの純関数（docs/クラウド同期設計.md §2）。
 *
 * アカウントは作らない。端末は「乱数 ID ＋ 乱数シークレット」だけで名乗り、
 * グループへの入場は招待コードだけで行う — サーバーが個人情報を持たないための構え。
 * ここは I/O を持たない純関数のみ（テスト対象）。保存・照合は sync-store が行う。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const INVITE_CODE_LENGTH = 8;

/**
 * 紛らわしい I/O/0/1 を抜いた 32 字母（モバイルの招待コード生成と同じ）。
 * 32 は 256 を割り切るので、剰余でのマッピングに偏りが出ない。
 */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * 招待コードの有効期限（設計 §10 で未決だった既定値を 24h に確定・2026-08-21）。
 * 家族に渡す用途ならその場〜当日中に使われる。期限切れはローテーションで再発行。
 */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** グループの最大端末数（設計 §10 の案 10 を採用） */
export const MAX_DEVICES_PER_GROUP = 10;

export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_ALPHABET[(bytes[i] as number) % INVITE_ALPHABET.length];
  }
  return code;
}

/** 入力ゆれの吸収: 空白・ハイフンを除き大文字化（読み上げ・手打ちを想定） */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function inviteExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}

export function isInviteExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/** 端末 ID・グループ ID（128bit 乱数・base64url） */
export function generateId(): string {
  return randomBytes(16).toString('base64url');
}

/** 端末シークレット（256bit 乱数）。平文は発行時に一度だけ返し、端末の secure-store にだけ残る */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** サーバーはシークレットのハッシュのみ保存する（Web共有の deleteToken と同じ方針） */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** タイミングセーフ比較。保存側が壊れた値でも throw しない（false を返す） */
export function verifySecretHash(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ParsedAuth {
  deviceId: string;
  secret: string;
}

/**
 * `Authorization: Bearer <deviceId>.<secret>` を分解する。
 * ID もシークレットも base64url（'.' を含まない）なので、最初の '.' で一意に切れる。
 */
export function parseAuthHeader(header: string | undefined): ParsedAuth | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = (match[1] as string).trim();
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  return { deviceId: token.slice(0, dot), secret: token.slice(dot + 1) };
}
