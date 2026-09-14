/**
 * 相談してレシピを作る（クライアント側の純粋な部分）。
 *
 * ここで守るのは、**在庫を渡していないのに在庫の話をしない**こと。
 * 「任意で渡す」を選んだ意味が、送っていないのにモデルが在庫前提で話し始めると消える。
 */
import {
  buildContextText,
  formDataToDraft,
  trimMessages,
  consultRecipe,
  resetConsultImageCache,
  type ConsultMessage,
} from '../recipe-consult.provider';
import type { RecipeFormData } from '../../validation/recipe.schema';
import { preprocessImageForOcr } from '../image-preprocess.service';
import * as FileSystem from 'expo-file-system/legacy';

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn().mockResolvedValue('base64data'),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('../image-preprocess.service', () => ({
  preprocessImageForOcr: jest.fn().mockResolvedValue({ imageUri: 'file:///processed.jpg' }),
}));

jest.mock('../byok.service', () => ({
  getUserApiKey: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../config', () => ({
  API_V1: 'http://test',
}));

jest.mock('../ai-output-locale', () => ({
  requestLocale: jest.fn().mockReturnValue('ja-JP'),
  requestUnitSystem: jest.fn().mockReturnValue('metric'),
  withOutputLanguage: jest.fn().mockImplementation((p) => p),
  withUnitSystem: jest.fn().mockImplementation((p) => p),
}));

jest.mock('../../i18n', () => ({
  t: jest.fn().mockImplementation((key) => key),
}));

const FORM: RecipeFormData = {
  title: '鶏むねの照り焼き',
  titleReading: '',
  description: '',
  ingredients: [{ groupLabel: '', name: '鶏むね肉', amount: '300g', note: '' }],
  steps: [{ body: 'そぎ切りにする' }],
  tags: [],
};

describe('buildContextText', () => {
  it('在庫を渡していなければ在庫の話をしない', () => {
    expect(buildContextText({ messages: [] })).toBe('');
    expect(buildContextText({ messages: [], pantry: [] })).toBe('');
    expect(buildContextText({ messages: [], pantry: ['   '] })).toBe('');
  });

  it('在庫を渡したときは「在庫だけで無理に作らない」も一緒に伝える', () => {
    const text = buildContextText({ messages: [], pantry: ['卵', '牛乳'] });
    expect(text).toContain('卵');
    expect(text).toContain('無理に作らない');
  });

  it('下書きがあれば添える（毎回ゼロから作り直させない）', () => {
    const text = buildContextText({ messages: [], draft: FORM });
    expect(text).toContain('鶏むねの照り焼き');
  });
});

describe('formDataToDraft', () => {
  it('空文字の項目は落とす（"" を送るとモデルが空欄を埋めようとする）', () => {
    const draft = formDataToDraft(FORM);
    expect(draft).not.toHaveProperty('titleReading');
    expect(draft).not.toHaveProperty('description');
    expect(draft).not.toHaveProperty('tags');
    expect(draft.ingredients[0]).not.toHaveProperty('groupLabel');
    expect(draft.ingredients[0]).not.toHaveProperty('note');
    expect(draft.ingredients[0]?.amount).toBe('300g');
  });
});

describe('trimMessages', () => {
  it('長い会話は古い方から落とす（直近ほど効く）', () => {
    const messages: ConsultMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: 'user',
      text: `m${i}`,
    }));
    const trimmed = trimMessages(messages, 10);

    expect(trimmed).toHaveLength(10);
    expect(trimmed[0]?.text).toBe('m20');
    expect(trimmed.at(-1)?.text).toBe('m29');
  });

  it('上限以下ならそのまま', () => {
    const messages: ConsultMessage[] = [{ role: 'user', text: 'a' }];
    expect(trimMessages(messages, 10)).toEqual(messages);
  });
});

describe('consultRecipe (Server)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetConsultImageCache();
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        ok: true,
        data: { reply: 'test', ready: false, draft: null },
      }),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('前処理は 45 秒予算の外 (A)', async () => {
    jest.useFakeTimers();
    (preprocessImageForOcr as jest.Mock).mockImplementation(() => {
      // 40 秒かかる前処理
      return new Promise((resolve) => {
        setTimeout(() => resolve({ imageUri: 'file:///processed.jpg' }), 40000);
      });
    });

    (global.fetch as jest.Mock).mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise((resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }

          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });

          setTimeout(() => {
            resolve({
              ok: true,
              json: jest.fn().mockResolvedValue({
                ok: true,
                data: { reply: 'test', ready: false, draft: null },
              }),
            });
          }, 10000); // 10秒かかる fetch
        });
      },
    );

    const promise = consultRecipe({
      messages: [{ role: 'user', text: 'test', imageUris: ['file:///original.jpg'] }],
    });

    // まず前処理(40秒)とfetch(10秒)を完了させるため、50秒進める
    await jest.advanceTimersByTimeAsync(50000);

    const result = await promise;
    expect(result.reply).toBe('test');
  });

  it('同じ画像を 2 往復送っても前処理は 1 回 (B)', async () => {
    (preprocessImageForOcr as jest.Mock).mockResolvedValue({ imageUri: 'file:///processed.jpg' });

    // 1 往復目
    await consultRecipe({
      messages: [{ role: 'user', text: 'hello', imageUris: ['file:///test.jpg'] }],
    });
    expect(preprocessImageForOcr).toHaveBeenCalledTimes(1);

    // 2 往復目（同じ画像）
    await consultRecipe({
      messages: [
        { role: 'user', text: 'hello', imageUris: ['file:///test.jpg'] },
        { role: 'assistant', text: 'hi' },
        { role: 'user', text: 'next' },
      ],
    });
    // キャッシュされているので 1 回のまま
    expect(preprocessImageForOcr).toHaveBeenCalledTimes(1);

    // キャッシュを消すと再度呼ばれる
    resetConsultImageCache();
    await consultRecipe({
      messages: [{ role: 'user', text: 'hello', imageUris: ['file:///test.jpg'] }],
    });
    expect(preprocessImageForOcr).toHaveBeenCalledTimes(2);
  });

  it('キャッシュ済み画像の読み込みに失敗したらキャッシュを捨てて次でやり直す', async () => {
    (preprocessImageForOcr as jest.Mock).mockResolvedValue({ imageUri: 'file:///processed.jpg' });

    // 1 往復目 (成功、キャッシュに乗る)
    await consultRecipe({
      messages: [{ role: 'user', text: 'hello', imageUris: ['file:///test2.jpg'] }],
    });
    expect(preprocessImageForOcr).toHaveBeenCalledTimes(1);

    // 2 往復目 (ファイルが消えていて readAsStringAsync が失敗する)
    (FileSystem.readAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));
    await consultRecipe({
      messages: [
        { role: 'user', text: 'hello', imageUris: ['file:///test2.jpg'] },
        { role: 'assistant', text: 'hi' },
        { role: 'user', text: 'next' },
      ],
    });
    // キャッシュから読もうとして失敗するので、この時点では preprocessImageForOcr は呼ばれない
    expect(preprocessImageForOcr).toHaveBeenCalledTimes(1);

    // 3 往復目 (キャッシュが捨てられているので、もう一度前処理が走る)
    await consultRecipe({
      messages: [
        { role: 'user', text: 'hello', imageUris: ['file:///test2.jpg'] },
        { role: 'assistant', text: 'hi' },
        { role: 'user', text: 'next' },
        { role: 'assistant', text: 'hi again' },
        { role: 'user', text: 'more' },
      ],
    });
    expect(preprocessImageForOcr).toHaveBeenCalledTimes(2);
  });

  it('サーバー経路でも pantry は 200 件に切り詰める (C)', async () => {
    const pantry = Array.from({ length: 300 }, (_, i) => `item${i}`);
    await consultRecipe({
      messages: [{ role: 'user', text: 'hello' }],
      pantry,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringMatching(/"pantry":\[(.*?)\]/),
      }),
    );

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.pantry).toHaveLength(200);
  });
});
