/**
 * アプリ内報告の受け口（docs/レシピ表紙AI生成設計.md §6）。
 * 個人情報を要求しないこと・x-device-id の書式チェック・常に 200(ok:true) を返すことを守る。
 */
import { describe, expect, it } from 'vitest';

import app from '../app.js';

const DEVICE_ID = 'abcdefgh12345678';

async function post(body: unknown, deviceId: string | null = DEVICE_ID): Promise<Response> {
  return app.request('/api/v1/report/content', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(deviceId ? { 'x-device-id': deviceId } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/report/content', () => {
  it('category だけでも受け付ける（text は任意）', async () => {
    const res = await post({ category: 'inappropriate' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('text・source も一緒に受け付ける', async () => {
    const res = await post({
      category: 'inaccurate',
      text: '材料に無いものが写っていた',
      source: 'cover-image',
    });
    expect(res.status).toBe(200);
  });

  it('x-device-id が無ければ拒否する', async () => {
    const res = await post({ category: 'other' }, null);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(false);
  });

  it('x-device-id の書式が不正なら拒否する', async () => {
    const res = await post({ category: 'other' }, 'short');
    expect(res.status).toBe(400);
  });

  it('category が未知の値なら 400（zod バリデーション）', async () => {
    const res = await post({ category: 'not-a-real-category' });
    expect(res.status).toBe(400);
  });

  it('text が 500 字を超えると 400', async () => {
    const res = await post({ category: 'other', text: 'あ'.repeat(501) });
    expect(res.status).toBe(400);
  });
});
