/**
 * POST /api/v1/infer/cover-image（レシピ表紙の AI 生成 / 「イメージ」）。
 * docs/レシピ表紙AI生成設計.md。
 *
 * ここで守りたいのは 4 つ。
 * 1. zod の境界（title/ingredientNames/tags の上限）。
 * 2. `x-device-id` の書式チェック（/infer/menu と同じ様式）。
 * 3. COVER_POOL が RECIPE_POOL と独立している
 *    （片方を使い切ってももう片方は生きる — rate-limit-pools.test.ts と同じ観点）。
 * 4. provider 失敗 → ok:false COVER_IMAGE_FAILED、成功 → mimeType/dataBase64 が返る。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../index.js';
import { setCoverImageProviderForTesting } from '../routes/infer.js';
import { resetRateLimitForTesting } from '../lib/rate-limit.js';
import {
  CoverImageQuotaError,
  CoverImageRequestError,
  buildCoverImagePrompt,
  type CoverImageInput,
  type CoverImageProvider,
  type CoverImageResult,
} from '../lib/cover-image.js';

function stub(
  reply: (input: CoverImageInput) => CoverImageResult | Promise<CoverImageResult>,
): CoverImageProvider {
  return { generate: async (input) => reply(input) };
}

const DEVICE_ID = 'device-abcdefgh01';

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request('/api/v1/infer/cover-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID, ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  title: '麻婆豆腐',
  ingredientNames: ['木綿豆腐', '豚ひき肉', '甜麺醤'],
  tags: ['中華'],
};

const STUB_RESULT: CoverImageResult = { mimeType: 'image/jpeg', dataBase64: 'ZmFrZQ==' };

type CoverImageResponse =
  | { ok: true; data: { mimeType: string; dataBase64: string } }
  | { ok: false; error: { code: string; retryable: boolean } };

const ENV_KEYS = ['COVER_IMAGE_GLOBAL_DAILY_LIMIT', 'COVER_IMAGE_DAILY_LIMIT'];

beforeEach(() => {
  setCoverImageProviderForTesting(null);
  resetRateLimitForTesting();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('POST /api/v1/infer/cover-image — 成功', () => {
  it('provider が成功したら mimeType と dataBase64 を返す', async () => {
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = await post(VALID_BODY);
    const json = (await res.json()) as CoverImageResponse;

    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.data.mimeType).toBe('image/jpeg');
      expect(json.data.dataBase64).toBe('ZmFrZQ==');
    }
  });
});

describe('POST /api/v1/infer/cover-image — エラー写像', () => {
  it('provider 失敗 → ok:false COVER_IMAGE_FAILED（retryable:true）', async () => {
    setCoverImageProviderForTesting({
      generate: async () => {
        throw new CoverImageRequestError('boom');
      },
    });
    const res = await post(VALID_BODY);
    const json = (await res.json()) as CoverImageResponse;

    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('COVER_IMAGE_FAILED');
      expect(json.error.retryable).toBe(true);
    }
  });

  it('上流の利用枠切れは AI_QUOTA_EXCEEDED（retryable:false）', async () => {
    setCoverImageProviderForTesting({
      generate: async () => {
        throw new CoverImageQuotaError('quota');
      },
    });
    const res = await post(VALID_BODY);
    const json = (await res.json()) as CoverImageResponse;

    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('AI_QUOTA_EXCEEDED');
      expect(json.error.retryable).toBe(false);
    }
  });
});

describe('POST /api/v1/infer/cover-image — x-device-id', () => {
  it('x-device-id が無いと受け付けない', async () => {
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = await app.request('/api/v1/infer/cover-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // x-device-id 無し
      body: JSON.stringify(VALID_BODY),
    });
    const json = (await res.json()) as CoverImageResponse;
    expect(json.ok).toBe(false);
  });

  it('x-device-id が書式違反（短すぎ）なら受け付けない', async () => {
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = await post(VALID_BODY, { 'x-device-id': 'short' });
    const json = (await res.json()) as CoverImageResponse;
    expect(json.ok).toBe(false);
  });
});

describe('POST /api/v1/infer/cover-image — zod の境界', () => {
  it('title が空なら 400', async () => {
    const res = await post({ ...VALID_BODY, title: '' });
    expect(res.status).toBe(400);
  });

  it('title が 100 字超なら 400', async () => {
    const res = await post({ ...VALID_BODY, title: 'あ'.repeat(101) });
    expect(res.status).toBe(400);
  });

  it('ingredientNames が 20 件超なら 400', async () => {
    const res = await post({
      ...VALID_BODY,
      ingredientNames: Array.from({ length: 21 }, (_, i) => `材料${i}`),
    });
    expect(res.status).toBe(400);
  });

  it('ingredientNames の 1 件が 50 字超なら 400', async () => {
    const res = await post({ ...VALID_BODY, ingredientNames: ['あ'.repeat(51)] });
    expect(res.status).toBe(400);
  });

  it('tags が 5 件超なら 400', async () => {
    const res = await post({
      ...VALID_BODY,
      tags: Array.from({ length: 6 }, (_, i) => `タグ${i}`),
    });
    expect(res.status).toBe(400);
  });

  it('ingredientNames/tags は 0 件でも通る（任意）', async () => {
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = await post({ title: '麻婆豆腐', ingredientNames: [], tags: [] });
    const json = (await res.json()) as CoverImageResponse;
    expect(json.ok).toBe(true);
  });

  it('locale は ja/en 以外なら 400', async () => {
    const res = await post({ ...VALID_BODY, locale: 'fr' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/infer/cover-image — COVER_POOL は独立している', () => {
  it('COVER_IMAGE_GLOBAL_DAILY_LIMIT を使い切っても /infer/menu 等（RECIPE_POOL）は無傷', async () => {
    process.env['COVER_IMAGE_GLOBAL_DAILY_LIMIT'] = '1';
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));

    const first = (await (await post(VALID_BODY)).json()) as CoverImageResponse;
    expect(first.ok).toBe(true);

    const second = (await (await post(VALID_BODY)).json()) as CoverImageResponse;
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('RATE_LIMITED');

    // RECIPE_POOL（INFER_GLOBAL_DAILY_LIMIT）は別カウンタなので、
    // /infer/menu は cover-image の枠切れに巻き込まれない
    const menuRes = await app.request('/api/v1/infer/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID },
      body: JSON.stringify({
        candidates: [{ id: 'a', title: 'レシピa', coveragePct: 80, missing: [] }],
        pantry: [],
        days: 1,
      }),
    });
    // AI_API_UNAVAILABLE（GEMINI_API_KEY 未設定）にはなり得るが、
    // 少なくとも cover-image の RATE_LIMITED では止まらない
    const menuJson = (await menuRes.json()) as { ok: boolean; error?: { code: string } };
    if (!menuJson.ok) expect(menuJson.error?.code).not.toBe('RATE_LIMITED');
  });

  it('INFER_GLOBAL_DAILY_LIMIT（RECIPE_POOL）を使い切っても cover-image は無傷', async () => {
    // menu 側を 1 発で使い切る
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '1';
    await app.request('/api/v1/infer/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID },
      body: JSON.stringify({
        candidates: [{ id: 'a', title: 'レシピa', coveragePct: 80, missing: [] }],
        pantry: [],
        days: 1,
      }),
    });

    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = (await (await post(VALID_BODY)).json()) as CoverImageResponse;
    expect(res.ok).toBe(true);
  });
});

describe('プロンプトの組み立て', () => {
  it('材料・タグを含める', () => {
    const text = buildCoverImagePrompt({
      title: '麻婆豆腐',
      ingredientNames: ['木綿豆腐', '豚ひき肉'],
      tags: ['中華'],
    });
    expect(text).toContain('麻婆豆腐');
    expect(text).toContain('木綿豆腐');
    expect(text).toContain('豚ひき肉');
    expect(text).toContain('中華');
  });

  it('材料に無い食材を描かない・文字やロゴを入れない、の縛りを含める', () => {
    const text = buildCoverImagePrompt({ title: '麻婆豆腐', ingredientNames: [], tags: [] });
    expect(text).toContain('材料リストに無い食材を描き足さない');
    expect(text).toContain('文字・ロゴ');
  });
});

describe('POST /api/v1/infer/cover-image — entry（入口の計測・Issue #313）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([['form'], ['detail']])(
    "entry: '%s' は 200 で通り、provider には渡らず、stdout の 1 行に載る",
    async (entry) => {
      const received: CoverImageInput[] = [];
      setCoverImageProviderForTesting(
        stub((input) => {
          received.push(input);
          return STUB_RESULT;
        }),
      );
      const write = vi.spyOn(process.stdout, 'write');

      const res = await post({ ...VALID_BODY, entry });
      expect(res.status).toBe(200);
      const json = (await res.json()) as CoverImageResponse;
      expect(json.ok).toBe(true);

      // entry はプロンプトの材料ではない — provider の入力に混ざらない
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        title: VALID_BODY.title,
        ingredientNames: VALID_BODY.ingredientNames,
        tags: VALID_BODY.tags,
        outputLocale: 'ja',
      });
      expect(received[0]).not.toHaveProperty('entry');

      // 計測の 1 行（個人情報なし: 料理名・端末 ID を含まない）
      const line = write.mock.calls
        .map((call) => String(call[0]))
        .find((s) => s.startsWith('[infer/cover-image]'));
      expect(line).toBe(`[infer/cover-image] entry=${entry} ok=true error=-\n`);
      expect(line).not.toContain(VALID_BODY.title);
      expect(line).not.toContain(DEVICE_ID);
    },
  );

  it('entry 無し（旧クライアント）の body も通り、ログは entry=unknown', async () => {
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const write = vi.spyOn(process.stdout, 'write');

    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(((await res.json()) as CoverImageResponse).ok).toBe(true);

    const line = write.mock.calls
      .map((call) => String(call[0]))
      .find((s) => s.startsWith('[infer/cover-image]'));
    expect(line).toBe('[infer/cover-image] entry=unknown ok=true error=-\n');
  });

  it('provider 失敗時のログは ok=false と error コードを載せる', async () => {
    setCoverImageProviderForTesting({
      generate: async () => {
        throw new CoverImageRequestError('boom');
      },
    });
    const write = vi.spyOn(process.stdout, 'write');

    await post({ ...VALID_BODY, entry: 'detail' });

    const line = write.mock.calls
      .map((call) => String(call[0]))
      .find((s) => s.startsWith('[infer/cover-image]'));
    expect(line).toBe('[infer/cover-image] entry=detail ok=false error=COVER_IMAGE_FAILED\n');
  });

  it("entry: 'sidebar' のような未知の値は zod で 400", async () => {
    setCoverImageProviderForTesting(stub(() => STUB_RESULT));
    const res = await post({ ...VALID_BODY, entry: 'sidebar' });
    expect(res.status).toBe(400);
  });

  it('未知キー（foo: 1）は strip されて通る（旧/新クライアント互換）', async () => {
    const received: CoverImageInput[] = [];
    setCoverImageProviderForTesting(
      stub((input) => {
        received.push(input);
        return STUB_RESULT;
      }),
    );

    const res = await post({ ...VALID_BODY, foo: 1 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as CoverImageResponse).ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).not.toHaveProperty('foo');
  });
});

describe('POST /api/v1/infer/cover-image — 弾いた要求でも計測行を書く（diff-critic 指摘）', () => {
  // 成功時だけ書くと「入口別の利用」が「入口別の成功生成」に縮み、
  // 日次プールを使い切ったあとの試行が入口ごとログから消える。
  // ここでは 3 経路（端末 ID 不正 / RATE_LIMITED / AI_API_UNAVAILABLE）で
  // 「1 行だけ」「entry が保たれる」「料理名・端末 ID を書かない」「生成は走らない」を固定する。
  const savedGeminiKey = process.env['GEMINI_API_KEY'];

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedGeminiKey === undefined) delete process.env['GEMINI_API_KEY'];
    else process.env['GEMINI_API_KEY'] = savedGeminiKey;
  });

  function spyStdout(): { lines: () => string[] } {
    const write = vi.spyOn(process.stdout, 'write');
    return {
      lines: () =>
        write.mock.calls
          .map((call) => String(call[0]))
          .filter((s) => s.startsWith('[infer/cover-image]')),
    };
  }

  function countingStub(): { provider: CoverImageProvider; calls: () => number } {
    let n = 0;
    return {
      provider: stub(() => {
        n += 1;
        return STUB_RESULT;
      }),
      calls: () => n,
    };
  }

  it('x-device-id 無し → ok=false error=UNKNOWN が 1 行、provider は呼ばれない', async () => {
    const { provider, calls } = countingStub();
    setCoverImageProviderForTesting(provider);
    const out = spyStdout();

    const res = await app.request('/api/v1/infer/cover-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // x-device-id 無し
      body: JSON.stringify({ ...VALID_BODY, entry: 'form' }),
    });
    const json = (await res.json()) as CoverImageResponse;
    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.error.code).toBe('UNKNOWN');

    expect(out.lines()).toEqual(['[infer/cover-image] entry=form ok=false error=UNKNOWN\n']);
    expect(calls()).toBe(0);
  });

  it('x-device-id が書式違反 → ok=false error=UNKNOWN が 1 行、端末 ID 文字列はログに出ない', async () => {
    const { provider, calls } = countingStub();
    setCoverImageProviderForTesting(provider);
    const out = spyStdout();

    const badId = 'short';
    const res = await post({ ...VALID_BODY, entry: 'detail' }, { 'x-device-id': badId });
    expect(((await res.json()) as CoverImageResponse).ok).toBe(false);

    const lines = out.lines();
    expect(lines).toEqual(['[infer/cover-image] entry=detail ok=false error=UNKNOWN\n']);
    expect(lines[0]).not.toContain(badId);
    expect(lines[0]).not.toContain(VALID_BODY.title);
    expect(calls()).toBe(0);
  });

  it('RATE_LIMITED で弾いた 2 回目も ok=false error=RATE_LIMITED が 1 行、entry=detail が保たれる', async () => {
    process.env['COVER_IMAGE_GLOBAL_DAILY_LIMIT'] = '1';
    const { provider, calls } = countingStub();
    setCoverImageProviderForTesting(provider);

    // 1 回目（枠を使い切る）。ここのログは対象外なので spy の前に済ませる
    const first = (await (
      await post({ ...VALID_BODY, entry: 'form' })
    ).json()) as CoverImageResponse;
    expect(first.ok).toBe(true);
    expect(calls()).toBe(1);

    const out = spyStdout();
    const second = (await (
      await post({ ...VALID_BODY, entry: 'detail' })
    ).json()) as CoverImageResponse;
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('RATE_LIMITED');

    const lines = out.lines();
    // entry=form（1 回目）に引きずられず、弾かれた要求自身の入口が出る
    expect(lines).toEqual(['[infer/cover-image] entry=detail ok=false error=RATE_LIMITED\n']);
    expect(lines[0]).not.toContain(VALID_BODY.title);
    expect(lines[0]).not.toContain(DEVICE_ID);
    // 弾かれた要求で生成が走っていない（ログを足したせいで provider が呼ばれる事故の検出）
    expect(calls()).toBe(1);
  });

  it('RATE_LIMITED で弾かれた旧クライアント（entry 無し）は entry=unknown', async () => {
    process.env['COVER_IMAGE_GLOBAL_DAILY_LIMIT'] = '1';
    const { provider, calls } = countingStub();
    setCoverImageProviderForTesting(provider);

    expect(((await (await post(VALID_BODY)).json()) as CoverImageResponse).ok).toBe(true);

    const out = spyStdout();
    const second = (await (await post(VALID_BODY)).json()) as CoverImageResponse;
    expect(second.ok).toBe(false);

    expect(out.lines()).toEqual([
      '[infer/cover-image] entry=unknown ok=false error=RATE_LIMITED\n',
    ]);
    expect(calls()).toBe(1);
  });

  it('GEMINI_API_KEY 未設定（CoverImageConfigError）→ ok=false error=AI_API_UNAVAILABLE が 1 行', async () => {
    delete process.env['GEMINI_API_KEY'];
    setCoverImageProviderForTesting(null); // 実 provider の解決へ落とす → 構築時に ConfigError
    const out = spyStdout();

    const res = await post({ ...VALID_BODY, entry: 'form' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as CoverImageResponse;
    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.error.code).toBe('AI_API_UNAVAILABLE');

    const lines = out.lines();
    expect(lines).toEqual(['[infer/cover-image] entry=form ok=false error=AI_API_UNAVAILABLE\n']);
    expect(lines[0]).not.toContain(VALID_BODY.title);
    expect(lines[0]).not.toContain(DEVICE_ID);
  });
});
