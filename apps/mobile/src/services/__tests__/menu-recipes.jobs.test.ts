/**
 * 一括生成の非同期ジョブ（R34）— クライアント側の HTTP。
 *
 * いちばん守りたいのは **「サーバーが古くても落ちない」**こと。アプリはサーバーより先に
 * 出ることがある（Play の公開とデプロイは同時だが、配信の伝播は別）。ジョブ経路が 404 なら
 * 例外ではなく `unsupported` を返し、呼び出し側が従来の同期経路へ倒せるようにする。
 */
const mockGetUserApiKey = jest.fn<Promise<string | null>, []>();
jest.mock('../byok.service', () => ({ getUserApiKey: () => mockGetUserApiKey() }));

const mockGetInstallationId = jest.fn<Promise<string>, []>();
jest.mock('../app-meta.service', () => ({ getInstallationId: () => mockGetInstallationId() }));

const mockResolveQuotaSource = jest.fn<Promise<'token' | 'premium' | undefined>, []>();
jest.mock('../usage.service', () => ({ resolveQuotaSource: () => mockResolveQuotaSource() }));

import {
  ackMenuRecipesJob,
  fetchMenuRecipesJob,
  MenuRecipesError,
  submitMenuRecipesJob,
  usesManagedMenuRecipes,
} from '../menu-recipes.provider';

const TOKEN = 'ExponentPushToken[abc]';
const PARTS = [
  { key: 'main', request: { days: 2, existingTitles: ['肉じゃが'], pantry: ['豆腐'] } },
  {
    key: 'soup',
    request: {
      days: 3,
      existingTitles: ['肉じゃが'],
      pantry: ['豆腐'],
      slotKind: 'soup',
      mainTitles: ['唐揚げ'],
    },
  },
];

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function call(index = 0): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
} {
  const [url, init] = fetchMock.mock.calls[index] as [
    string,
    { method: string; headers: Record<string, string>; body?: string },
  ];
  return {
    url,
    method: init.method,
    headers: init.headers,
    body: init.body ? JSON.parse(init.body) : undefined,
  };
}

beforeEach(() => {
  mockGetUserApiKey.mockReset().mockResolvedValue(null);
  mockGetInstallationId.mockReset().mockResolvedValue('device-abc-123');
  mockResolveQuotaSource.mockReset().mockResolvedValue(undefined);
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('submitMenuRecipesJob', () => {
  it('受理されたら jobId を返す。x-device-id・parts・locale・push トークンを送る', async () => {
    respond(202, { ok: true, data: { jobId: 'job-1', status: 'queued' } });
    await expect(submitMenuRecipesJob(PARTS, TOKEN)).resolves.toEqual({
      kind: 'accepted',
      jobId: 'job-1',
    });

    const sent = call();
    expect(sent.url).toMatch(/\/infer\/menu-recipes\/jobs$/);
    expect(sent.method).toBe('POST');
    expect(sent.headers['x-device-id']).toBe('device-abc-123');
    expect(sent.body).toMatchObject({ expoPushToken: TOKEN, locale: expect.any(String) });
    const parts = (sent.body as { parts: { key: string; request: Record<string, unknown> }[] })
      .parts;
    expect(parts.map((p) => p.key)).toEqual(['main', 'soup']);
    expect(parts[1]?.request).toMatchObject({ slotKind: 'soup', mainTitles: ['唐揚げ'], days: 3 });
  });

  it('**主菜の part には slotKind も mainTitles も載せない**（同期版と同じ要求の形）', async () => {
    respond(202, { ok: true, data: { jobId: 'job-1' } });
    await submitMenuRecipesJob(PARTS, null);
    const parts = (call().body as { parts: { request: Record<string, unknown> }[] }).parts;
    expect(parts[0]?.request).not.toHaveProperty('slotKind');
    expect(parts[0]?.request).not.toHaveProperty('mainTitles');
  });

  it('push トークンが無ければ載せない（許可を断られても投入はできる）', async () => {
    respond(202, { ok: true, data: { jobId: 'job-1' } });
    await submitMenuRecipesJob(PARTS, null);
    expect(call().body).not.toHaveProperty('expoPushToken');
  });

  it('トークン消費のときは x-quota-source: token を送る', async () => {
    mockResolveQuotaSource.mockResolvedValue('token');
    respond(202, { ok: true, data: { jobId: 'job-1' } });
    await submitMenuRecipesJob(PARTS, null);
    expect(call().headers['x-quota-source']).toBe('token');
  });

  it.each([404, 405])(
    '**サーバーが古い（%i）→ 例外にせず unsupported**（呼び出し側が同期経路へ倒す）',
    async (status) => {
      respond(status, {});
      await expect(submitMenuRecipesJob(PARTS, null)).resolves.toEqual({ kind: 'unsupported' });
    },
  );

  it('その環境でジョブを使えない（AI_API_UNAVAILABLE）→ unsupported', async () => {
    respond(200, { ok: false, error: { code: 'AI_API_UNAVAILABLE', retryable: false } });
    await expect(submitMenuRecipesJob(PARTS, null)).resolves.toEqual({ kind: 'unsupported' });
  });

  it('無料枠切れは retryable=false の MenuRecipesError（同期経路へ倒さない — 同じ理由で落ちる）', async () => {
    respond(200, { ok: false, error: { code: 'FREE_QUOTA_EXCEEDED', retryable: false } });
    await expect(submitMenuRecipesJob(PARTS, null)).rejects.toMatchObject({ retryable: false });
  });

  it('通信できないときは MenuRecipesError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(submitMenuRecipesJob(PARTS, null)).rejects.toBeInstanceOf(MenuRecipesError);
  });
});

describe('fetchMenuRecipesJob — 投げない', () => {
  it('queued / running は pending', async () => {
    respond(200, { ok: true, data: { status: 'running' } });
    await expect(fetchMenuRecipesJob('job-1')).resolves.toEqual({ kind: 'pending' });
    expect(call().url).toMatch(/\/jobs\/job-1$/);
    expect(call().headers['x-device-id']).toBe('device-abc-123');
  });

  it('done は part ごとの成否をそのまま返す（壊れた part は落とす）', async () => {
    respond(200, {
      ok: true,
      data: {
        status: 'done',
        parts: [
          { key: 'main', ok: true, recipes: [{ title: 'A' }] },
          { key: 'soup', ok: false, error: { code: 'UNKNOWN' } },
          { ok: true, recipes: [] },
        ],
      },
    });
    await expect(fetchMenuRecipesJob('job-1')).resolves.toEqual({
      kind: 'done',
      parts: [
        { key: 'main', ok: true, recipes: [{ title: 'A' }] },
        { key: 'soup', ok: false },
      ],
    });
  });

  it('failed は retryable を運ぶ', async () => {
    respond(200, { ok: true, data: { status: 'failed', error: { retryable: false } } });
    await expect(fetchMenuRecipesJob('job-1')).resolves.toEqual({
      kind: 'failed',
      retryable: false,
    });
  });

  it('404 は gone（期限切れ・受け取り済み）', async () => {
    respond(404, {});
    await expect(fetchMenuRecipesJob('job-1')).resolves.toEqual({ kind: 'gone' });
  });

  it('**5xx・通信不能は unreachable**（控えを消させない — 次の機会にもう一度聞く）', async () => {
    respond(502, {});
    await expect(fetchMenuRecipesJob('job-1')).resolves.toEqual({ kind: 'unreachable' });
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(fetchMenuRecipesJob('job-1')).resolves.toEqual({ kind: 'unreachable' });
  });
});

describe('ackMenuRecipesJob / usesManagedMenuRecipes', () => {
  it('DELETE を送る。失敗しても投げない（24 時間で自然に消える）', async () => {
    respond(204, {});
    await ackMenuRecipesJob('job-1');
    expect(call().method).toBe('DELETE');
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(ackMenuRecipesJob('job-1')).resolves.toBeUndefined();
  });

  it('自前キー（BYOK）があるときはサーバー経由ではない（非同期にしない）', async () => {
    await expect(usesManagedMenuRecipes()).resolves.toBe(true);
    mockGetUserApiKey.mockResolvedValue('AIza-user-key');
    await expect(usesManagedMenuRecipes()).resolves.toBe(false);
  });
});
