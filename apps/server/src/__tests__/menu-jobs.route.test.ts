/**
 * 一括生成の非同期ジョブ（R34・POST/GET/DELETE /api/v1/infer/menu-recipes/jobs）。
 *
 * ここで守りたいこと（消すと赤くなる形で固定する）:
 * 1. 判定順: 端末 ID → 月次枠 → 二重投入 → 日次上限。枠切れの連打が共有プールを食わない
 * 2. 日次上限は part の数だけ・月次枠は 1 ジョブ 1 回・**成功したときだけ**
 * 3. 完了後の行に入力（在庫名・嗜好メモ）と push トークンが残らない
 * 4. 他人のジョブは 404（存在を漏らさない）
 * 5. push に内容（料理名）を載せない
 * 6. 再起動の回収は 1 回だけ再実行。2 回目は RESTARTED で閉じて知らせる
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ExpoPush from '../lib/expo-push.js';

process.env['INFER_QUOTA_DB_PATH'] = ':memory:';
process.env['INFER_JOBS_DB_PATH'] = ':memory:';

vi.mock('../lib/expo-push.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ExpoPush>()),
  sendExpoPush: vi.fn(async () => ({ deadTokens: [] })),
}));

import { eq } from 'drizzle-orm';

import app from '../index.js';
import { sendExpoPush } from '../lib/expo-push.js';
import { setMenuRecipesProviderForTesting } from '../lib/infer-guards.js';
import { drainForTesting, kickRunner, recoverMenuJobs } from '../lib/menu-job-runner.js';
import {
  MENU_JOB_RESULT_TTL_MS,
  getMenuJobDb,
  menuJobs,
  resetMenuJobStoreForTesting,
  sweepMenuJobs,
} from '../lib/menu-job-store.js';
import type { MenuRecipesInput, MenuRecipesRaw } from '../lib/menu-recipes.js';
import { peekMonthlyQuota, resetQuotaStoreForTesting } from '../lib/quota-store.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';

const DEVICE = 'device-abcdefgh01';
const OTHER_DEVICE = 'device-zzzzzzzz99';
const TOKEN = 'ExponentPushToken[abcDEF123_-]';
const BASE = '/api/v1/infer/menu-recipes/jobs';
const ENV_KEYS = [
  'INFER_GLOBAL_DAILY_LIMIT',
  'INFER_DAILY_LIMIT',
  'INFER_MONTHLY_FREE_LIMIT',
  'AWS_LAMBDA_FUNCTION_NAME',
];

function draft(title: string) {
  return {
    title,
    description: '平日向けの一品',
    ingredients: [{ name: '鶏むね肉', amount: '1枚' }],
    steps: [{ body: '焼く' }],
  };
}

function useProvider(reply: (input: MenuRecipesInput) => MenuRecipesRaw | Promise<MenuRecipesRaw>) {
  setMenuRecipesProviderForTesting({ generate: async (input) => reply(input) });
}

const request = (extra: Record<string, unknown> = {}) => ({
  days: 1,
  existingTitles: [],
  pantry: [],
  ...extra,
});

async function post(
  body: unknown,
  headers: Record<string, string> = {},
  deviceId: string | null = DEVICE,
): Promise<Response> {
  return app.request(BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(deviceId ? { 'x-device-id': deviceId } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const get = (jobId: string, deviceId = DEVICE) =>
  app.request(`${BASE}/${jobId}`, { headers: { 'x-device-id': deviceId } });

const del = (jobId: string, deviceId = DEVICE) =>
  app.request(`${BASE}/${jobId}`, { method: 'DELETE', headers: { 'x-device-id': deviceId } });

interface Accepted {
  ok: true;
  data: { jobId: string; status: string };
}
interface Rejected {
  ok: false;
  error: { code: string };
}
interface JobView {
  ok: true;
  data: {
    jobId: string;
    status: string;
    parts?: (
      | { key: string; ok: true; recipes: { title: string }[] }
      | { key: string; ok: false }
    )[];
    error?: { code: string; retryable: boolean };
  };
}

async function submit(body: unknown, headers: Record<string, string> = {}): Promise<string> {
  const res = await post(body, headers);
  expect(res.status).toBe(202);
  return ((await res.json()) as Accepted).data.jobId;
}

const row = (jobId: string) =>
  getMenuJobDb().select().from(menuJobs).where(eq(menuJobs.id, jobId)).get();

/** 月次枠が残っているか（消費されたかの観測に使う） */
const hasQuota = (limit: number) => peekMonthlyQuota(DEVICE, 'infer', limit);

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetRateLimitForTesting();
  resetQuotaStoreForTesting();
  resetMenuJobStoreForTesting();
  vi.mocked(sendExpoPush).mockClear();
  useProvider(() => ({ recipes: [draft('鶏の照り焼き')] }));
});

afterEach(async () => {
  await drainForTesting();
  setMenuRecipesProviderForTesting(null);
});

describe('POST /jobs — 受理', () => {
  it('202 で jobId を返し、生成は応答の後で走って done になる', async () => {
    const jobId = await submit({ parts: [{ key: 'main', request: request() }] });
    await drainForTesting();

    const body = (await (await get(jobId)).json()) as JobView;
    expect(body.data.status).toBe('done');
    expect(body.data.parts).toEqual([
      { key: 'main', ok: true, recipes: [expect.objectContaining({ title: '鶏の照り焼き' })] },
    ]);
  });

  it('端末 ID が無い・書式が違うと受理しない（行も作らない）', async () => {
    const res = await post({ parts: [{ key: 'main', request: request() }] }, {}, null);
    expect(((await res.json()) as Rejected).error.code).toBe('UNKNOWN');
    expect(getMenuJobDb().select().from(menuJobs).all()).toHaveLength(0);
  });

  it('**月次枠切れは日次上限より先に弾く**（枠切れの連打が共有プールを食わない）', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '2';
    await submit({ parts: [{ key: 'main', request: request() }] });
    await drainForTesting(); // 成功 → 月次枠 1 回を消費。日次は 1/2

    for (let i = 0; i < 5; i += 1) {
      const res = await post({ parts: [{ key: 'main', request: request() }] });
      expect(((await res.json()) as Rejected).error.code).toBe('FREE_QUOTA_EXCEEDED');
    }
    // 連打が日次を食っていれば、ここで RATE_LIMITED になる
    const res = await post(
      { parts: [{ key: 'main', request: request() }] },
      { 'x-quota-source': 'token' },
    );
    expect(res.status).toBe(202);
  });

  it('同じ端末の二重投入は同じ jobId を返し、日次上限を二重に消費しない', async () => {
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '2';
    let release: (raw: MenuRecipesRaw) => void = () => undefined;
    useProvider(() => new Promise<MenuRecipesRaw>((resolve) => (release = resolve)));

    const first = await submit({ parts: [{ key: 'main', request: request() }] });
    const second = await submit({ parts: [{ key: 'main', request: request() }] });
    const third = await submit({ parts: [{ key: 'main', request: request() }] });
    expect(second).toBe(first);
    expect(third).toBe(first);

    release({ recipes: [draft('鶏の照り焼き')] });
    await drainForTesting();
    useProvider(() => ({ recipes: [draft('鶏の照り焼き')] })); // 次の投入は待たせない
    // 消費が 1 回だけなら、あと 1 回ぶん残っている
    expect((await post({ parts: [{ key: 'main', request: request() }] })).status).toBe(202);
  });

  it('日次上限は **part の数だけ**消費する', async () => {
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '3';
    const parts = [
      { key: 'main', request: request() },
      { key: 'soup', request: request({ slotKind: 'soup' }) },
    ];
    await submit({ parts });
    await drainForTesting();
    // 2 消費済み。もう 2 part は入らない（1 なら入る）
    const over = await post({ parts }, { 'x-quota-source': 'token' });
    expect(((await over.json()) as Rejected).error.code).toBe('RATE_LIMITED');
    const fits = await post(
      { parts: [{ key: 'main', request: request() }] },
      { 'x-quota-source': 'token' },
    );
    expect(fits.status).toBe(202);
  });

  it('part の key が重複していたら 400（結果の突き合わせができない）', async () => {
    const res = await post({
      parts: [
        { key: 'main', request: request() },
        { key: 'main', request: request() },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('Expo の書式でない push トークンは 400（任意の宛先を中継させない）', async () => {
    const res = await post({
      parts: [{ key: 'main', request: request() }],
      expoPushToken: 'https://evil.example/hook',
    });
    expect(res.status).toBe(400);
  });

  it('Lambda では受理しない（応答後の処理が保証されない。アプリは同期経路へ倒す）', async () => {
    process.env['AWS_LAMBDA_FUNCTION_NAME'] = 'daidoko-api';
    const res = await post({ parts: [{ key: 'main', request: request() }] });
    expect(((await res.json()) as Rejected).error.code).toBe('AI_API_UNAVAILABLE');
    expect(getMenuJobDb().select().from(menuJobs).all()).toHaveLength(0);
  });

  it('slotKind と mainTitles が provider まで届く（副菜・汁物を頼める）', async () => {
    const seen: MenuRecipesInput[] = [];
    useProvider((input) => {
      seen.push(input);
      return { recipes: [draft(`${input.slotKind ?? 'main'}の一品`)] };
    });
    await submit({
      parts: [
        { key: 'main', request: request() },
        { key: 'soup', request: request({ slotKind: 'soup', mainTitles: ['唐揚げ'] }) },
      ],
    });
    await drainForTesting();
    expect(seen.map((i) => i.slotKind ?? 'main').sort()).toEqual(['main', 'soup']);
    expect(seen.find((i) => i.slotKind === 'soup')?.mainTitles).toEqual(['唐揚げ']);
  });
});

describe('完了・失敗の扱い', () => {
  it('完了: 月次枠を 1 回だけ消費し、入力と push トークンを行から消す', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '2';
    const jobId = await submit({
      parts: [
        { key: 'main', request: request({ preferences: '義母は洋食を食べない' }) },
        { key: 'side', request: request({ slotKind: 'side' }) },
      ],
      expoPushToken: TOKEN,
    });
    await drainForTesting();

    const saved = row(jobId);
    expect(saved?.status).toBe('done');
    expect(saved?.inputJson).toBeNull();
    expect(saved?.expoPushToken).toBeNull();
    // 2 part でも消費は 1 回（limit 2 なら、まだ 1 回残る）
    expect(hasQuota(2)).toBe(true);
    expect(hasQuota(1)).toBe(false);
  });

  it('push は 1 通・type=menu・**料理名を載せない**', async () => {
    const jobId = await submit({
      parts: [{ key: 'main', request: request() }],
      expoPushToken: TOKEN,
      locale: 'ja',
    });
    await drainForTesting();

    expect(sendExpoPush).toHaveBeenCalledTimes(1);
    const message = vi.mocked(sendExpoPush).mock.calls[0]?.[0]?.[0];
    expect(message).toMatchObject({
      to: TOKEN,
      title: 'だいどこ',
      channelId: 'menu',
      data: { type: 'menu', jobId, status: 'done' },
    });
    expect(JSON.stringify(message)).not.toContain('鶏の照り焼き');
  });

  it('英語ロケールは英語の文面', async () => {
    await submit({
      parts: [{ key: 'main', request: request() }],
      expoPushToken: TOKEN,
      locale: 'en',
    });
    await drainForTesting();
    const message = vi.mocked(sendExpoPush).mock.calls[0]?.[0]?.[0];
    expect(message?.title).toBe('DAIDOKO');
    expect(message?.body).toMatch(/ready/);
  });

  it('push トークンが無ければ送らない', async () => {
    await submit({ parts: [{ key: 'main', request: request() }] });
    await drainForTesting();
    expect(sendExpoPush).not.toHaveBeenCalled();
  });

  it('全 part 失敗: failed・失敗の push・**月次枠を消費しない**', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    useProvider(() => {
      throw new Error('boom');
    });
    const jobId = await submit({
      parts: [{ key: 'main', request: request() }],
      expoPushToken: TOKEN,
    });
    await drainForTesting();

    const body = (await (await get(jobId)).json()) as JobView;
    expect(body.data.status).toBe('failed');
    expect(body.data.error?.retryable).toBe(true);
    expect(body.data.parts).toBeUndefined();
    expect(hasQuota(1)).toBe(true);
    const message = vi.mocked(sendExpoPush).mock.calls[0]?.[0]?.[0];
    expect(message?.data).toMatchObject({ status: 'failed' });
    expect(row(jobId)?.inputJson).toBeNull();
  });

  it('一部だけ失敗: done で、失敗した part は ok:false で同梱。消費は 1 回', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    useProvider((input) => {
      if (input.slotKind === 'soup') throw new Error('soup failed');
      return { recipes: [draft('鶏の照り焼き')] };
    });
    const jobId = await submit({
      parts: [
        { key: 'main', request: request() },
        { key: 'soup', request: request({ slotKind: 'soup' }) },
      ],
    });
    await drainForTesting();

    const body = (await (await get(jobId)).json()) as JobView;
    expect(body.data.status).toBe('done');
    expect(body.data.parts?.map((p) => [p.key, p.ok])).toEqual([
      ['main', true],
      ['soup', false],
    ]);
    expect(hasQuota(1)).toBe(false);
  });

  it('x-quota-source: token は月次枠を消費しない', async () => {
    process.env['INFER_MONTHLY_FREE_LIMIT'] = '1';
    await submit({ parts: [{ key: 'main', request: request() }] }, { 'x-quota-source': 'token' });
    await drainForTesting();
    expect(hasQuota(1)).toBe(true);
  });
});

describe('GET / DELETE — 持ち主だけが読める', () => {
  it('別の端末 ID では 404（403 にしない — jobId の存在を漏らさない）', async () => {
    const jobId = await submit({ parts: [{ key: 'main', request: request() }] });
    await drainForTesting();
    expect((await get(jobId, OTHER_DEVICE)).status).toBe(404);
    expect((await get(jobId)).status).toBe(200);
  });

  it('別の端末からの DELETE では消えない', async () => {
    const jobId = await submit({ parts: [{ key: 'main', request: request() }] });
    await drainForTesting();
    expect((await del(jobId, OTHER_DEVICE)).status).toBe(204);
    expect((await get(jobId)).status).toBe(200);
  });

  it('DELETE は 204 で行を消し、2 回目も 204（受け取り済みの再送を失敗にしない）', async () => {
    const jobId = await submit({ parts: [{ key: 'main', request: request() }] });
    await drainForTesting();
    expect((await del(jobId)).status).toBe(204);
    expect((await get(jobId)).status).toBe(404);
    expect((await del(jobId)).status).toBe(204);
  });

  it('存在しない jobId は 404', async () => {
    expect((await get('00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});

describe('sweep と起動時の回収', () => {
  function insert(values: Partial<typeof menuJobs.$inferInsert> & { id: string }) {
    const now = new Date().toISOString();
    getMenuJobDb()
      .insert(menuJobs)
      .values({
        deviceId: DEVICE,
        status: 'queued',
        inputJson: JSON.stringify([
          { key: 'main', request: { days: 1, existingTitles: [], pantry: [] } },
        ]),
        bypassQuota: false,
        attempts: 0,
        createdAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...values,
      })
      .run();
  }

  it('期限切れの行は消える（GET も 404）', async () => {
    insert({
      id: 'job-expired',
      status: 'done',
      expiresAt: new Date(Date.now() - 1).toISOString(),
    });
    expect((await get('job-expired')).status).toBe(404); // sweep の前でも読ませない
    sweepMenuJobs();
    expect(row('job-expired')).toBeUndefined();
  });

  it('完了した行の寿命は完了から 24 時間', async () => {
    const before = Date.now();
    const jobId = await submit({ parts: [{ key: 'main', request: request() }] });
    await drainForTesting();
    const expiresAt = Date.parse(row(jobId)?.expiresAt ?? '');
    expect(expiresAt).toBeGreaterThanOrEqual(before + MENU_JOB_RESULT_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + MENU_JOB_RESULT_TTL_MS);
  });

  it('走りっぱなしの行は TIMEOUT で閉じ、入力を消す', () => {
    insert({
      id: 'job-stuck',
      status: 'running',
      startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    insert({ id: 'job-fresh', status: 'running', startedAt: new Date().toISOString() });
    sweepMenuJobs();
    expect(row('job-stuck')).toMatchObject({
      status: 'failed',
      errorCode: 'TIMEOUT',
      inputJson: null,
    });
    expect(row('job-fresh')?.status).toBe('running');
  });

  it('回収: 1 回目の実行中に落ちた行は queued へ戻り、再実行されて done になる', async () => {
    insert({ id: 'job-crashed-once', status: 'running', attempts: 1 });
    await recoverMenuJobs();
    expect(row('job-crashed-once')?.status).toBe('queued');
    kickRunner();
    await drainForTesting();
    expect(row('job-crashed-once')).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('回収: 2 回目も落ちた行は RESTARTED で閉じ、失敗を知らせる（無限に再実行しない）', async () => {
    insert({ id: 'job-crashed-twice', status: 'running', attempts: 2, expoPushToken: TOKEN });
    await recoverMenuJobs();
    expect(row('job-crashed-twice')).toMatchObject({
      status: 'failed',
      errorCode: 'RESTARTED',
      expoPushToken: null,
    });
    expect(vi.mocked(sendExpoPush).mock.calls[0]?.[0]?.[0]?.data).toMatchObject({
      status: 'failed',
    });
  });
});

describe('旧クライアント互換', () => {
  it('同期の POST /infer/menu-recipes は slotKind 無しで従来どおり動く', async () => {
    const res = await app.request('/api/v1/infer/menu-recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE },
      body: JSON.stringify(request()),
    });
    const body = (await res.json()) as { ok: boolean; data?: { recipes: { title: string }[] } };
    expect(body.ok).toBe(true);
    expect(body.data?.recipes[0]?.title).toBe('鶏の照り焼き');
  });
});
