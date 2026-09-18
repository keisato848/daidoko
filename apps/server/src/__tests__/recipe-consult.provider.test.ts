/**
 * `GeminiRecipeConsultProvider`（`lib/recipe-consult.ts`）— Gemini の raw JSON 応答を
 * パースする層を直接叩く。`consult.route.test.ts` は `setConsultProviderForTesting` で
 * プロバイダ自体をスタブしているため、このパース処理（`imageReadings` の並び替え・
 * trim・空文字除去）は一度も通っていなかった（2026-09-17 Gemini レビュー #4b・#5）。
 *
 * ここで固定するのは、`imageReadings` が `originalIndex` の**昇順で**文字列化されること
 * （#5: モデルが順不同・一部欠落で返しても、並べ替えずに使うとラベルがずれる）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeminiRecipeConsultProvider, type ConsultRecipeInput } from '../lib/recipe-consult.js';

const ORIGINAL_KEY = process.env['GEMINI_API_KEY'];

function stubFetchReturning(candidateText: string) {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: candidateText }] } }] }),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
}

const baseInput: ConsultRecipeInput = {
  messages: [{ role: 'user', text: '写真の内容で何か作りたい' }],
};

describe('GeminiRecipeConsultProvider — imageReadings のパース', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env['GEMINI_API_KEY'] = ORIGINAL_KEY;
  });

  it('originalIndex が順不同でも、昇順に並べ替えて返す', async () => {
    process.env['GEMINI_API_KEY'] = 'dummy-key-for-test';
    stubFetchReturning(
      JSON.stringify({
        reply: 'はい',
        ready: false,
        imageReadings: [
          { originalIndex: 1, reading: 'B: にんじん' },
          { originalIndex: 0, reading: 'A: 玉ねぎ' },
        ],
      }),
    );
    const provider = new GeminiRecipeConsultProvider();
    const result = await provider.consult(baseInput);
    expect(result.imageReadings).toEqual(['A: 玉ねぎ', 'B: にんじん']);
  });

  it('originalIndex が欠けている項目は 0 として扱い、極端な位置に飛ばない', async () => {
    process.env['GEMINI_API_KEY'] = 'dummy-key-for-test';
    stubFetchReturning(
      JSON.stringify({
        reply: 'はい',
        ready: false,
        imageReadings: [{ originalIndex: 2, reading: 'C' }, { reading: 'A' }],
      }),
    );
    const provider = new GeminiRecipeConsultProvider();
    const result = await provider.consult(baseInput);
    expect(result.imageReadings).toEqual(['A', 'C']);
  });

  it('imageReadings が空配列なら戻り値にキー自体が出ない', async () => {
    process.env['GEMINI_API_KEY'] = 'dummy-key-for-test';
    stubFetchReturning(JSON.stringify({ reply: 'はい', ready: false, imageReadings: [] }));
    const provider = new GeminiRecipeConsultProvider();
    const result = await provider.consult(baseInput);
    expect(result.imageReadings).toBeUndefined();
  });
});
