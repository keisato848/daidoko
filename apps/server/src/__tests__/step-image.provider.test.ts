/**
 * `GeminiStepImageProvider`（`lib/step-image.ts`）— 表紙の provider を継承して
 * `buildPrompt` だけ差し替えたもの（docs/レシピ表紙AI生成設計.md §8-3）。
 *
 * `fetch` を stub して**送られる body** を見る。ここで守りたいのは 4 つ。
 * 1. モデル解決の優先順位: `STEP_IMAGE_MODEL` → `COVER_IMAGE_MODEL` → 既定。
 * 2. 手順のプロンプト（縛り・手順番号）が送られ、表紙の「写真のように」が混ざらない
 *    ＝ `buildPrompt` の override が効いている。
 * 3. 時間予算が表紙と同じ定数（`REQUEST_TIMEOUT_MS`）で打ち切られる
 *    （Issue #314「retry-budget が step でも同じ定数」）。
 * 4. 総称化した `GeminiCoverImageProvider` の**表紙の振る舞いが変わっていない**。
 *
 * プロンプトの文面はテスト内リテラルで固定する（実装の定数を import して比べない）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CoverImageRequestError,
  GeminiCoverImageProvider,
  REQUEST_TIMEOUT_MS,
  buildCoverImagePrompt,
  type CoverImageInput,
} from '../lib/cover-image.js';
import { GeminiStepImageProvider, type StepImageInput } from '../lib/step-image.js';

const ENV_KEYS = ['STEP_IMAGE_MODEL', 'COVER_IMAGE_MODEL'];
const ORIGINAL_ENV: Record<string, string | undefined> = {};

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    input: Array<{ type: string; text: string }>;
    response_format: { type: string; mime_type: string; image_size: string };
  };
}

/** Interactions API の実応答の形（`cover-image.ts` の `extractModelOutputImage` が読む形）。 */
const FAKE_INTERACTIONS_RESPONSE = {
  steps: [
    { type: 'thought', signature: 'opaque' },
    { type: 'model_output', content: [{ type: 'image', data: 'QUJD', mime_type: 'image/jpeg' }] },
  ],
};

function stubFetchCapturing(): { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: { ...(init?.headers as Record<string, string>) },
      body: JSON.parse(String(init?.body)) as CapturedRequest['body'],
    });
    return new Response(JSON.stringify(FAKE_INTERACTIONS_RESPONSE), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

const STEP_INPUT: StepImageInput = {
  title: '麻婆豆腐',
  ingredientNames: ['木綿豆腐', '豚ひき肉'],
  tags: [],
  stepBody: '豆腐をさいの目に切り、湯通しする',
  stepIndex: 2,
  stepCount: 5,
};

const COVER_INPUT: CoverImageInput = {
  title: '麻婆豆腐',
  ingredientNames: ['木綿豆腐', '豚ひき肉'],
  tags: ['中華'],
};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    ORIGINAL_ENV[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

describe('GeminiStepImageProvider — モデル解決の優先順位', () => {
  it('STEP_IMAGE_MODEL があればそれ（COVER_IMAGE_MODEL より優先）', async () => {
    process.env['STEP_IMAGE_MODEL'] = 'step-model-x';
    process.env['COVER_IMAGE_MODEL'] = 'cover-model-y';
    const { calls } = stubFetchCapturing();

    await new GeminiStepImageProvider({ apiKey: 'k' }).generate(STEP_INPUT);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.model).toBe('step-model-x');
  });

  it('STEP_IMAGE_MODEL が無ければ COVER_IMAGE_MODEL に倣う', async () => {
    process.env['COVER_IMAGE_MODEL'] = 'cover-model-y';
    const { calls } = stubFetchCapturing();

    await new GeminiStepImageProvider({ apiKey: 'k' }).generate(STEP_INPUT);

    expect(calls[0]?.body.model).toBe('cover-model-y');
  });

  it('どちらも無ければ既定 gemini-3.1-flash-lite-image', async () => {
    const { calls } = stubFetchCapturing();

    await new GeminiStepImageProvider({ apiKey: 'k' }).generate(STEP_INPUT);

    expect(calls[0]?.body.model).toBe('gemini-3.1-flash-lite-image');
  });

  it('空白だけの STEP_IMAGE_MODEL は「無い」扱いで COVER_IMAGE_MODEL に落ちる', async () => {
    process.env['STEP_IMAGE_MODEL'] = '   ';
    process.env['COVER_IMAGE_MODEL'] = 'cover-model-y';
    const { calls } = stubFetchCapturing();

    await new GeminiStepImageProvider({ apiKey: 'k' }).generate(STEP_INPUT);

    expect(calls[0]?.body.model).toBe('cover-model-y');
  });

  it('opts.model は env より優先', async () => {
    process.env['STEP_IMAGE_MODEL'] = 'step-model-x';
    const { calls } = stubFetchCapturing();

    await new GeminiStepImageProvider({ apiKey: 'k', model: 'explicit-model' }).generate(
      STEP_INPUT,
    );

    expect(calls[0]?.body.model).toBe('explicit-model');
  });
});

describe('GeminiStepImageProvider — 手順のプロンプトを送る（buildPrompt の override）', () => {
  it('body の input[0].text に縛り「完成皿を描かない」と手順番号の行がある', async () => {
    const { calls } = stubFetchCapturing();

    await new GeminiStepImageProvider({ apiKey: 'k' }).generate(STEP_INPUT);

    const text = calls[0]?.body.input[0]?.text ?? '';
    expect(calls[0]?.body.input[0]?.type).toBe('text');
    expect(text).toContain('完成した料理の盛り付け（できあがりの一皿）を描かない。');
    expect(text).toContain('手描きの絵のようなイラストにする。');
    expect(text.split('\n')).toContain('手順 2 / 5: 豆腐をさいの目に切り、湯通しする');
  });

  it('表紙の「写真のように」が混ざらない（混ざると縛りが逆になる）', async () => {
    const { calls } = stubFetchCapturing();

    await new GeminiStepImageProvider({ apiKey: 'k' }).generate(STEP_INPUT);

    const text = calls[0]?.body.input[0]?.text ?? '';
    expect(text).not.toContain('写真のように');
    expect(text).not.toContain('自然な盛り付けにする');
  });

  it('outputLocale:en なら英語の末尾行になる', async () => {
    const { calls } = stubFetchCapturing();

    await new GeminiStepImageProvider({ apiKey: 'k' }).generate({
      ...STEP_INPUT,
      outputLocale: 'en',
    });

    const text = calls[0]?.body.input[0]?.text ?? '';
    expect(text).toContain('Draw it as a simple hand-drawn cooking illustration');
    expect(text).not.toContain('日本の家庭の台所で');
  });

  it('輸送部は表紙と同じ（Interactions エンドポイント・x-goog-api-key・image_size 1K・JPEG）', async () => {
    const { calls } = stubFetchCapturing();

    const result = await new GeminiStepImageProvider({ apiKey: 'secret-key' }).generate(STEP_INPUT);

    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(calls[0]?.headers['x-goog-api-key']).toBe('secret-key');
    expect(calls[0]?.body.response_format).toEqual({
      type: 'image',
      mime_type: 'image/jpeg',
      image_size: '1K',
    });
    // 応答は model_output の画像から拾う（thought.signature を拾わない）
    expect(result).toEqual({ mimeType: 'image/jpeg', dataBase64: 'QUJD' });
  });
});

describe('GeminiStepImageProvider — 時間予算は表紙と同じ定数', () => {
  it('REQUEST_TIMEOUT_MS ちょうどで abort され、timed out として失敗する', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init?.signal ?? undefined;
            signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      ),
    );

    const pending = new GeminiStepImageProvider({ apiKey: 'k' }).generate(STEP_INPUT);
    // 未処理拒否にならないよう先に受け口を付けておく
    const outcome = pending.then(
      () => ({ kind: 'ok' as const }),
      (err: unknown) => ({ kind: 'err' as const, err }),
    );

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(signal, 'fetch に signal が渡っていない').toBeDefined();
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);

    const settled = await outcome;
    expect(settled.kind).toBe('err');
    if (settled.kind === 'err') {
      expect(settled.err).toBeInstanceOf(CoverImageRequestError);
      expect((settled.err as Error).message).toBe('Gemini request timed out');
    }
  });
});

describe('GeminiCoverImageProvider — 総称化しても表紙の振る舞いは不変', () => {
  it('body の text が buildCoverImagePrompt と一致し、「写真のように」を含む', async () => {
    const { calls } = stubFetchCapturing();

    await new GeminiCoverImageProvider({ apiKey: 'k' }).generate(COVER_INPUT);

    const text = calls[0]?.body.input[0]?.text ?? '';
    expect(text).toBe(buildCoverImagePrompt(COVER_INPUT));
    // 手順の縛りが表紙に漏れていない
    expect(text).toContain('この料理のできあがりを写真のように 1 枚描いてください。');
    expect(text).toContain('タグ: 中華');
    expect(text).not.toContain('完成した料理の盛り付け（できあがりの一皿）を描かない');
    expect(text).not.toContain('手順 ');
  });

  it('モデルは COVER_IMAGE_MODEL → 既定（STEP_IMAGE_MODEL は表紙に影響しない）', async () => {
    process.env['STEP_IMAGE_MODEL'] = 'step-model-x';
    const { calls } = stubFetchCapturing();

    await new GeminiCoverImageProvider({ apiKey: 'k' }).generate(COVER_INPUT);
    expect(calls[0]?.body.model).toBe('gemini-3.1-flash-lite-image');

    process.env['COVER_IMAGE_MODEL'] = 'cover-model-y';
    await new GeminiCoverImageProvider({ apiKey: 'k' }).generate(COVER_INPUT);
    expect(calls[1]?.body.model).toBe('cover-model-y');
  });
});
