/**
 * POST /api/v1/infer/step-image（手順のイラストの AI 生成）。
 * docs/レシピ表紙AI生成設計.md §8-2（枠）・§8-3（契約）。
 *
 * `cover-image.route.test.ts` と同じ流儀。ここで守りたいのは 5 つ。
 * 1. zod の境界（title/ingredientNames/stepBody/stepIndex/stepCount）。境界ちょうどは通る。
 * 2. `x-device-id` の書式チェック（表紙と同じ様式）。
 * 3. provider に `stepBody`・`stepIndex`・`stepCount` が**そのまま**渡る
 *    （落とすと「どの手順の絵も同じ」になる）。
 * 4. 4 つの出口すべてで stdout 1 行 `[infer/step-image] ok=<bool> error=<code>`。
 *    料理名・手順の本文・端末 ID はログに出さない。
 * 5. STEP_POOL が COVER_POOL と独立している（§8-2「一括が表紙の天井を食う」を防ぐ核心）。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import app from '../index.js';
import {
  setCoverImageProviderForTesting,
  setStepImageProviderForTesting,
} from '../routes/infer.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import {
  CoverImageQuotaError,
  CoverImageRequestError,
  type CoverImageResult,
} from '../lib/cover-image.js';
import type { StepImageInput, StepImageProvider } from '../lib/step-image.js';

function stub(
  reply: (input: StepImageInput) => CoverImageResult | Promise<CoverImageResult>,
): StepImageProvider {
  return { generate: async (input) => reply(input) };
}

const DEVICE_ID = 'device-abcdefgh01';

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request('/api/v1/infer/step-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID, ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  title: '麻婆豆腐',
  ingredientNames: ['木綿豆腐', '豚ひき肉', '甜麺醤'],
  stepBody: '豆腐をさいの目に切り、湯通しする',
  stepIndex: 2,
  stepCount: 5,
};

const STUB_RESULT: CoverImageResult = { mimeType: 'image/jpeg', dataBase64: 'ZmFrZQ==' };

type StepImageResponse =
  | { ok: true; data: { mimeType: string; dataBase64: string } }
  | { ok: false; error: { code: string; retryable: boolean } };

const ENV_KEYS = [
  'STEP_IMAGE_GLOBAL_DAILY_LIMIT',
  'STEP_IMAGE_DAILY_LIMIT',
  'COVER_IMAGE_GLOBAL_DAILY_LIMIT',
  'COVER_IMAGE_DAILY_LIMIT',
];
const ORIGINAL_GEMINI_API_KEY = process.env['GEMINI_API_KEY'];

/** stdout に出た `[infer/step-image]` の行だけを拾う（vitest 自身の出力は含めない）。 */
function captureStepImageLog(): { lines: () => string[] } {
  const written: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  return {
    lines: () =>
      written
        .join('')
        .split('\n')
        .filter((l) => l.startsWith('[infer/step-image]')),
  };
}

beforeEach(() => {
  setStepImageProviderForTesting(null);
  setCoverImageProviderForTesting(null);
  resetRateLimitForTesting();
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) delete process.env[key];
  if (ORIGINAL_GEMINI_API_KEY === undefined) delete process.env['GEMINI_API_KEY'];
  else process.env['GEMINI_API_KEY'] = ORIGINAL_GEMINI_API_KEY;
});

describe('POST /api/v1/infer/step-image — 成功', () => {
  it('provider が成功したら 200 で mimeType と dataBase64 を返す', async () => {
    setStepImageProviderForTesting(stub(() => STUB_RESULT));
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    const json = (await res.json()) as StepImageResponse;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.mimeType).toBe('image/jpeg');
      expect(json.data.dataBase64).toBe('ZmFrZQ==');
    }
  });

  it('provider に stepBody・stepIndex・stepCount がそのまま渡る（落とすと全手順が同じ絵になる）', async () => {
    const generate = vi.fn(async (_input: StepImageInput) => STUB_RESULT);
    setStepImageProviderForTesting({ generate });

    await post(VALID_BODY);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '麻婆豆腐',
        ingredientNames: ['木綿豆腐', '豚ひき肉', '甜麺醤'],
        stepBody: '豆腐をさいの目に切り、湯通しする',
        stepIndex: 2,
        stepCount: 5,
      }),
    );
  });

  it('locale=en は outputLocale:en として provider に渡る（省略時は ja）', async () => {
    const generate = vi.fn(async (_input: StepImageInput) => STUB_RESULT);
    setStepImageProviderForTesting({ generate });

    await post({ ...VALID_BODY, locale: 'en' });
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ outputLocale: 'en' }));

    await post(VALID_BODY);
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ outputLocale: 'ja' }));
  });
});

describe('POST /api/v1/infer/step-image — エラー写像（表紙のコードを流用）', () => {
  it('provider 失敗 → 200 で ok:false COVER_IMAGE_FAILED（retryable:true）', async () => {
    setStepImageProviderForTesting({
      generate: async () => {
        throw new CoverImageRequestError('boom');
      },
    });
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    const json = (await res.json()) as StepImageResponse;

    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('COVER_IMAGE_FAILED');
      expect(json.error.retryable).toBe(true);
    }
  });

  it('上流の利用枠切れは AI_QUOTA_EXCEEDED（retryable:false）', async () => {
    setStepImageProviderForTesting({
      generate: async () => {
        throw new CoverImageQuotaError('quota');
      },
    });
    const json = (await (await post(VALID_BODY)).json()) as StepImageResponse;

    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('AI_QUOTA_EXCEEDED');
      expect(json.error.retryable).toBe(false);
    }
  });

  it('GEMINI_API_KEY 未設定（provider 差し替え無し）→ 200 で AI_API_UNAVAILABLE', async () => {
    delete process.env['GEMINI_API_KEY'];
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    const json = (await res.json()) as StepImageResponse;
    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.error.code).toBe('AI_API_UNAVAILABLE');
  });
});

describe('POST /api/v1/infer/step-image — x-device-id', () => {
  it('x-device-id が無いと ok:false UNKNOWN。provider は呼ばれない', async () => {
    const generate = vi.fn(async () => STUB_RESULT);
    setStepImageProviderForTesting({ generate });
    const res = await app.request('/api/v1/infer/step-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // x-device-id 無し
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as StepImageResponse;
    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.error.code).toBe('UNKNOWN');
    expect(generate).not.toHaveBeenCalled();
  });

  it('x-device-id が書式違反（短すぎ）なら ok:false UNKNOWN。provider は呼ばれない', async () => {
    const generate = vi.fn(async () => STUB_RESULT);
    setStepImageProviderForTesting({ generate });
    const json = (await (
      await post(VALID_BODY, { 'x-device-id': 'short' })
    ).json()) as StepImageResponse;
    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.error.code).toBe('UNKNOWN');
    expect(generate).not.toHaveBeenCalled();
  });

  it('x-device-id に許可外の文字（空白）があれば ok:false UNKNOWN', async () => {
    setStepImageProviderForTesting(stub(() => STUB_RESULT));
    const json = (await (
      await post(VALID_BODY, { 'x-device-id': 'device abcdefgh01' })
    ).json()) as StepImageResponse;
    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.error.code).toBe('UNKNOWN');
  });
});

describe('POST /api/v1/infer/step-image — zod の境界', () => {
  let generate: Mock<[StepImageInput], Promise<CoverImageResult>>;

  beforeEach(() => {
    generate = vi.fn(async (_input: StepImageInput) => STUB_RESULT);
    setStepImageProviderForTesting({ generate });
  });

  async function expect400(body: unknown): Promise<void> {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  }

  async function expectOk(body: unknown): Promise<void> {
    const res = await post(body);
    expect(res.status).toBe(200);
    const json = (await res.json()) as StepImageResponse;
    expect(json.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  }

  it('title が空なら 400', () => expect400({ ...VALID_BODY, title: '' }));
  it('title が 101 字なら 400', () => expect400({ ...VALID_BODY, title: 'あ'.repeat(101) }));
  it('title が 100 字ちょうどは通る', () => expectOk({ ...VALID_BODY, title: 'あ'.repeat(100) }));

  it('ingredientNames が 21 件なら 400', () =>
    expect400({
      ...VALID_BODY,
      ingredientNames: Array.from({ length: 21 }, (_, i) => `材料${i}`),
    }));
  it('ingredientNames が 20 件ちょうどは通る', () =>
    expectOk({
      ...VALID_BODY,
      ingredientNames: Array.from({ length: 20 }, (_, i) => `材料${i}`),
    }));
  it('ingredientNames の 1 件が 51 字なら 400', () =>
    expect400({ ...VALID_BODY, ingredientNames: ['あ'.repeat(51)] }));
  it('ingredientNames は 0 件でも通る', () => expectOk({ ...VALID_BODY, ingredientNames: [] }));

  it('stepBody が空なら 400', () => expect400({ ...VALID_BODY, stepBody: '' }));
  it('stepBody が 501 字なら 400', () => expect400({ ...VALID_BODY, stepBody: 'あ'.repeat(501) }));
  it('stepBody が 500 字ちょうどは通る', () =>
    expectOk({ ...VALID_BODY, stepBody: 'あ'.repeat(500) }));
  it('stepBody が無ければ 400（表紙の body をそのまま投げても通らない）', () =>
    expect400({
      title: '麻婆豆腐',
      ingredientNames: [],
      tags: ['中華'],
      stepIndex: 1,
      stepCount: 1,
    }));

  it('stepIndex が 0 なら 400', () => expect400({ ...VALID_BODY, stepIndex: 0 }));
  it('stepIndex が小数なら 400', () => expect400({ ...VALID_BODY, stepIndex: 1.5 }));
  it('stepIndex が 1 は通る', () => expectOk({ ...VALID_BODY, stepIndex: 1, stepCount: 1 }));

  it('stepCount が 0 なら 400', () => expect400({ ...VALID_BODY, stepCount: 0 }));
  it('stepCount が 51 なら 400', () => expect400({ ...VALID_BODY, stepCount: 51 }));
  it('stepCount が小数なら 400', () => expect400({ ...VALID_BODY, stepCount: 5.5 }));
  it('stepCount が 50 ちょうどは通る', () => expectOk({ ...VALID_BODY, stepCount: 50 }));

  it('locale は ja/en 以外なら 400', () => expect400({ ...VALID_BODY, locale: 'fr' }));
});

describe('POST /api/v1/infer/step-image — stdout のログ（4 つの出口すべてで 1 行）', () => {
  const LINE = /^\[infer\/step-image\] ok=(true|false) error=(\S+)$/;

  function expectSingleLine(lines: string[], ok: boolean, code: string): void {
    expect(lines).toHaveLength(1);
    const m = LINE.exec(lines[0] ?? '');
    expect(m, `書式違反: ${lines[0]}`).not.toBeNull();
    expect(m?.[1]).toBe(String(ok));
    expect(m?.[2]).toBe(code);
    // 料理名・手順の本文・端末 ID は出さない
    expect(lines[0]).not.toContain(VALID_BODY.title);
    expect(lines[0]).not.toContain(VALID_BODY.stepBody);
    expect(lines[0]).not.toContain(DEVICE_ID);
  }

  it('出口①: x-device-id 不正 → ok=false error=UNKNOWN', async () => {
    const log = captureStepImageLog();
    setStepImageProviderForTesting(stub(() => STUB_RESULT));
    await post(VALID_BODY, { 'x-device-id': 'short' });
    expectSingleLine(log.lines(), false, 'UNKNOWN');
  });

  it('出口②: STEP_POOL 上限 → ok=false error=RATE_LIMITED（provider は呼ばれない）', async () => {
    // 上限は 1 にして 2 発目で止める（`limitFromEnv` は 0 を「上限なし」と読むので 0 では止まらない）
    process.env['STEP_IMAGE_GLOBAL_DAILY_LIMIT'] = '1';
    const generate = vi.fn(async () => STUB_RESULT);
    setStepImageProviderForTesting({ generate });
    expect(((await (await post(VALID_BODY)).json()) as StepImageResponse).ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);

    const log = captureStepImageLog();
    const json = (await (await post(VALID_BODY)).json()) as StepImageResponse;
    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.error.code).toBe('RATE_LIMITED');
    expect(generate).toHaveBeenCalledTimes(1);
    expectSingleLine(log.lines(), false, 'RATE_LIMITED');
  });

  it('出口③: GEMINI_API_KEY 未設定 → ok=false error=AI_API_UNAVAILABLE', async () => {
    delete process.env['GEMINI_API_KEY'];
    const log = captureStepImageLog();
    await post(VALID_BODY);
    expectSingleLine(log.lines(), false, 'AI_API_UNAVAILABLE');
  });

  it('出口④-成功: ok=true error=-', async () => {
    setStepImageProviderForTesting(stub(() => STUB_RESULT));
    const log = captureStepImageLog();
    await post(VALID_BODY);
    expectSingleLine(log.lines(), true, '-');
  });

  it('出口④-失敗: provider 失敗 → ok=false error=COVER_IMAGE_FAILED', async () => {
    setStepImageProviderForTesting({
      generate: async () => {
        throw new CoverImageRequestError('boom');
      },
    });
    const log = captureStepImageLog();
    await post(VALID_BODY);
    expectSingleLine(log.lines(), false, 'COVER_IMAGE_FAILED');
  });
});

describe('POST /api/v1/infer/step-image — STEP_POOL は COVER_POOL と独立している（§8-2）', () => {
  const COVER_BODY = { title: '麻婆豆腐', ingredientNames: ['木綿豆腐'], tags: ['中華'] };

  async function postCover(): Promise<StepImageResponse> {
    const res = await app.request('/api/v1/infer/cover-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID },
      body: JSON.stringify(COVER_BODY),
    });
    return (await res.json()) as StepImageResponse;
  }

  it('STEP_IMAGE_GLOBAL_DAILY_LIMIT=1 で手順を使い切っても /infer/cover-image は通る', async () => {
    process.env['STEP_IMAGE_GLOBAL_DAILY_LIMIT'] = '1';
    const stepGenerate = vi.fn(async () => STUB_RESULT);
    const coverGenerate = vi.fn(async () => STUB_RESULT);
    setStepImageProviderForTesting({ generate: stepGenerate });
    setCoverImageProviderForTesting({ generate: coverGenerate });

    const first = (await (await post(VALID_BODY)).json()) as StepImageResponse;
    expect(first.ok).toBe(true);
    const second = (await (await post(VALID_BODY)).json()) as StepImageResponse;
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('RATE_LIMITED');
    expect(stepGenerate).toHaveBeenCalledTimes(1);

    const cover = await postCover();
    expect(cover.ok).toBe(true);
    expect(coverGenerate).toHaveBeenCalledTimes(1);
  });

  it('COVER_IMAGE_GLOBAL_DAILY_LIMIT=1 で表紙を使い切っても /infer/step-image は通る（一括が表紙の天井を食わない核心）', async () => {
    process.env['COVER_IMAGE_GLOBAL_DAILY_LIMIT'] = '1';
    const stepGenerate = vi.fn(async () => STUB_RESULT);
    const coverGenerate = vi.fn(async () => STUB_RESULT);
    setStepImageProviderForTesting({ generate: stepGenerate });
    setCoverImageProviderForTesting({ generate: coverGenerate });

    expect((await postCover()).ok).toBe(true);
    const coverSecond = await postCover();
    expect(coverSecond.ok).toBe(false);
    if (!coverSecond.ok) expect(coverSecond.error.code).toBe('RATE_LIMITED');
    expect(coverGenerate).toHaveBeenCalledTimes(1);

    // 一括生成の形: 同じ端末が続けて何枚も叩く
    for (let i = 1; i <= 3; i += 1) {
      const step = (await (
        await post({ ...VALID_BODY, stepIndex: i, stepCount: 3 })
      ).json()) as StepImageResponse;
      expect(step.ok, `手順 ${i} 枚目`).toBe(true);
    }
    expect(stepGenerate).toHaveBeenCalledTimes(3);
  });

  it('クライアント別上限も独立（COVER_IMAGE_DAILY_LIMIT=1 で表紙が止まっても同じ IP の手順は通る）', async () => {
    process.env['COVER_IMAGE_DAILY_LIMIT'] = '1';
    process.env['STEP_IMAGE_DAILY_LIMIT'] = '1';
    setStepImageProviderForTesting(stub(() => STUB_RESULT));
    setCoverImageProviderForTesting({ generate: async () => STUB_RESULT });
    const ip = { 'x-forwarded-for': '203.0.113.7' };

    const coverReq = () =>
      app.request('/api/v1/infer/cover-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID, ...ip },
        body: JSON.stringify(COVER_BODY),
      });

    expect(((await (await coverReq()).json()) as StepImageResponse).ok).toBe(true);
    const coverSecond = (await (await coverReq()).json()) as StepImageResponse;
    expect(coverSecond.ok).toBe(false);
    if (!coverSecond.ok) expect(coverSecond.error.code).toBe('RATE_LIMITED');

    // 同じ IP からの手順は、表紙のクライアント別上限に巻き込まれない
    const step = (await (await post(VALID_BODY, ip)).json()) as StepImageResponse;
    expect(step.ok).toBe(true);
    // 逆向き: 手順が止まっても表紙のカウンタは増えていない（表紙の 2 発目は既に上限だが、
    // 手順の 2 発目が RATE_LIMITED になるのは STEP 側のクライアント上限による）
    const stepSecond = (await (await post(VALID_BODY, ip)).json()) as StepImageResponse;
    expect(stepSecond.ok).toBe(false);
    if (!stepSecond.ok) expect(stepSecond.error.code).toBe('RATE_LIMITED');
  });
});
