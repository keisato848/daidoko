/**
 * X-Forwarded-For の先頭は呼び出し側が自由に書ける。信頼できるのは自分の直前の
 * プロキシ（Railway）が追記した末尾だけ（sync.ts の元コメント・PR #345 の脆弱性修正）。
 */
import { describe, expect, it } from 'vitest';

import { getClientIp } from '../client-ip.js';

function headersOf(values: Record<string, string>): { get: (name: string) => string | null } {
  return { get: (name: string) => values[name] ?? null };
}

describe('getClientIp', () => {
  it('X-Forwarded-For の末尾（信頼できるプロキシの追記分）を使う', () => {
    expect(getClientIp(headersOf({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('先頭に偽装された値があっても、末尾を優先する（レート制限バイパス対策）', () => {
    expect(getClientIp(headersOf({ 'x-forwarded-for': '203.0.113.1, 203.0.113.2, 5.5.5.5' }))).toBe(
      '5.5.5.5',
    );
  });

  it('単一の値ならそのまま使う', () => {
    expect(getClientIp(headersOf({ 'x-forwarded-for': '5.5.5.5' }))).toBe('5.5.5.5');
  });

  it('X-Forwarded-For が無ければ x-real-ip にフォールバックする', () => {
    expect(getClientIp(headersOf({ 'x-real-ip': '7.7.7.7' }))).toBe('7.7.7.7');
  });

  it('どちらも無ければ anonymous', () => {
    expect(getClientIp(headersOf({}))).toBe('anonymous');
  });
});
