/**
 * 相談してレシピを作る（POST /api/v1/infer/consult）。
 *
 * ここで守りたいのは 2 つ。
 * 1. **下書きが無い往復が正当**であること（まだ質問している段階）。
 * 2. **半端な下書きを ready と言わない**こと — 保存できそうに見えて保存できない、
 *    が一番たちが悪い。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import app from '../index.js';
import { setConsultProviderForTesting } from '../routes/infer.js';
import {
  ConsultQuotaError,
  buildConsultResponseSchema,
  trimMessages,
  buildContextText,
  type ConsultRecipeInput,
  type ConsultRecipeRaw,
  type RecipeConsultProvider,
} from '../lib/recipe-consult.js';

function stub(
  reply: (input: ConsultRecipeInput) => ConsultRecipeRaw | Promise<ConsultRecipeRaw>,
): RecipeConsultProvider {
  return { consult: async (input) => reply(input) };
}

async function post(body: unknown) {
  return app.request('/api/v1/infer/consult', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const FULL_DRAFT = {
  title: '鶏むねのやわらか照り焼き',
  ingredients: [{ name: '鶏むね肉', amount: '300g' }],
  steps: [{ body: '鶏むね肉をそぎ切りにする。' }],
};

beforeEach(() => setConsultProviderForTesting(null));

describe('POST /api/v1/infer/consult', () => {
  it('まだ料理が絞れない往復では、下書きなしで返事だけ返す', async () => {
    setConsultProviderForTesting(stub(() => ({ reply: '何人ぶんにしますか？', ready: false })));
    const res = await post({ messages: [{ role: 'user', text: '何か作りたい' }] });
    const json = (await res.json()) as { ok: boolean; data: { draft: unknown; ready: boolean } };

    expect(json.ok).toBe(true);
    expect(json.data.draft).toBeNull();
    expect(json.data.ready).toBe(false);
  });

  it('材料と手順が揃えば下書きを返す', async () => {
    setConsultProviderForTesting(
      stub(() => ({ reply: 'こんな感じでどうでしょう。', ready: true, draft: FULL_DRAFT })),
    );
    const res = await post({ messages: [{ role: 'user', text: '鶏むねで何か' }] });
    const json = (await res.json()) as {
      data: { ready: boolean; draft: { title: string; confidence: string } };
    };

    expect(json.data.ready).toBe(true);
    expect(json.data.draft.title).toBe('鶏むねのやわらか照り焼き');
    // 会話で本人が決めた内容なので、写真からの推測より確からしい
    expect(json.data.draft.confidence).toBe('high');
  });

  it('手順が空の下書きは ready と言わない（保存できないのに保存できそうに見える）', async () => {
    setConsultProviderForTesting(
      stub(() => ({
        reply: 'できました。',
        ready: true,
        draft: { title: 'カレー', ingredients: [{ name: '玉ねぎ' }], steps: [] },
      })),
    );
    const res = await post({ messages: [{ role: 'user', text: 'カレー' }] });
    const json = (await res.json()) as { data: { ready: boolean; draft: unknown } };

    expect(json.data.draft).toBeNull();
    expect(json.data.ready).toBe(false);
  });

  it('返事が空でも無言にしない（会話が止まる）', async () => {
    setConsultProviderForTesting(stub(() => ({ reply: '   ', ready: false })));
    const res = await post({ messages: [{ role: 'user', text: 'うどん' }] });
    const json = (await res.json()) as { data: { reply: string } };

    expect(json.data.reply.length).toBeGreaterThan(0);
  });

  it('在庫は渡したときだけモデルへ届く', async () => {
    const seen: { value: ConsultRecipeInput | null } = { value: null };
    setConsultProviderForTesting(
      stub((input) => {
        seen.value = input;
        return { reply: 'はい', ready: false };
      }),
    );

    await post({ messages: [{ role: 'user', text: '何か' }] });
    expect(seen.value?.pantry).toBeUndefined();

    await post({ messages: [{ role: 'user', text: '何か' }], pantry: ['卵', '牛乳'] });
    expect(seen.value?.pantry).toEqual(['卵', '牛乳']);
  });

  it('上流の利用枠切れは「つながらない」と区別する', async () => {
    setConsultProviderForTesting({
      consult: async () => {
        throw new ConsultQuotaError('quota');
      },
    });
    const res = await post({ messages: [{ role: 'user', text: 'うどん' }] });
    const json = (await res.json()) as { ok: boolean; error: { code: string; retryable: boolean } };

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('AI_QUOTA_EXCEEDED');
    expect(json.error.retryable).toBe(false);
  });

  it('空の会話は受け付けない', async () => {
    const res = await post({ messages: [] });
    expect(res.status).toBe(400);
  });
});

describe('会話の組み立て', () => {
  it('長い会話は古い方から落とす（直近ほど効くため）', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: 'user' as const,
      text: `m${i}`,
    }));
    const trimmed = trimMessages(messages, 10);

    expect(trimmed).toHaveLength(10);
    expect(trimmed[0]?.text).toBe('m20');
    expect(trimmed.at(-1)?.text).toBe('m29');
  });

  it('在庫が無ければ在庫の話をプロンプトに入れない', () => {
    expect(buildContextText({ messages: [] })).toBe('');
    expect(buildContextText({ messages: [], pantry: [] })).toBe('');
  });

  it('在庫を渡したときは「在庫だけで無理に作らない」も一緒に伝える', () => {
    const text = buildContextText({ messages: [], pantry: ['卵'] });
    expect(text).toContain('卵');
    expect(text).toContain('無理に作らない');
  });

  it('返事は必須。下書きは「まだ出せない」が正当なので必須にしない', () => {
    const schema = buildConsultResponseSchema();
    expect(schema.required).toContain('reply');
    expect(schema.required).toContain('ready');
    expect(schema.required).not.toContain('draft');
  });
});
