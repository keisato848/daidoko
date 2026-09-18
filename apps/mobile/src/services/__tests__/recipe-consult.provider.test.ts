/**
 * 相談してレシピを作る（クライアント側の純粋な部分）。
 *
 * ここで守るのは、**在庫を渡していないのに在庫の話をしない**こと。
 * 「任意で渡す」を選んだ意味が、送っていないのにモデルが在庫前提で話し始めると消える。
 */

const mockReadAsStringAsync = jest.fn<Promise<string>, [string]>();
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: (path: string) => mockReadAsStringAsync(path),
  EncodingType: { Base64: 'base64' },
}));

const mockPreprocessImageForOcr = jest.fn<
  Promise<{ imageUri: string; width: number; height: number }>,
  [string]
>();
jest.mock('../image-preprocess.service', () => ({
  preprocessImageForOcr: (uri: string) => mockPreprocessImageForOcr(uri),
}));

jest.mock('../expo-image-preprocess.adapter', () => ({
  expoImageManipulatorPreprocessAdapter: {},
}));

const mockGetUserApiKey = jest.fn<Promise<string | null>, []>();
jest.mock('../byok.service', () => ({
  getUserApiKey: () => mockGetUserApiKey(),
}));

import {
  buildContextText,
  formDataToDraft,
  trimMessages,
  MAX_CONSULT_IMAGES_PER_MESSAGE,
  toWireMessages,
  consultRecipe,
  type ConsultMessage,
} from '../recipe-consult.provider';
import type { RecipeFormData } from '../../validation/recipe.schema';

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

describe('toWireMessages', () => {
  beforeEach(() => {
    mockReadAsStringAsync.mockResolvedValue('base64');
    mockPreprocessImageForOcr.mockImplementation(async (uri) => ({
      imageUri: uri,
      width: 100,
      height: 100,
    }));
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('imageReadings が無い user メッセージは images に base64 が乗る', async () => {
    const wire = await toWireMessages([{ role: 'user', text: 'a', imageUris: ['foo.jpg'] }]);
    expect(wire[0]?.images).toEqual([{ imageBase64: 'base64', mimeType: 'image/jpeg' }]);
    expect(mockReadAsStringAsync).toHaveBeenCalled();
  });

  it('imageReadings がある user メッセージは images が無く imageReadings が乗り、FileSystem.readAsStringAsync が呼ばれない', async () => {
    const wire = await toWireMessages([
      { role: 'user', text: 'a', imageUris: ['foo.jpg'], imageReadings: ['reading1'] },
    ]);
    expect(wire[0]?.images).toBeUndefined();
    expect(wire[0]?.imageReadings).toEqual(['reading1']);
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
  });
});

describe('consultRecipe サーバー経路', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockReadAsStringAsync.mockResolvedValue('base64');
    mockPreprocessImageForOcr.mockImplementation(async (uri) => ({
      imageUri: uri,
      width: 100,
      height: 100,
    }));
    mockGetUserApiKey.mockResolvedValue(null);
    // サーバーレスポンスのモック
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: { reply: 'ok', ready: false, draft: null, imageReadings: ['reading2'] },
      }),
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('MAX_CONSULT_IMAGES_PER_MESSAGE === 4', () => {
    expect(MAX_CONSULT_IMAGES_PER_MESSAGE).toBe(4);
  });

  it('pantry 301 件を渡すと fetch の body の pantry.length === 200', async () => {
    const pantry = Array.from({ length: 301 }, (_, i) => `p${i}`);
    await consultRecipe({ messages: [{ role: 'user', text: 'a' }], pantry });
    const calls = (global.fetch as jest.Mock).mock.calls;
    const reqBody = JSON.parse(calls[0][1].body);
    expect(reqBody.pantry).toHaveLength(200);
  });

  it('応答に imageReadings があれば ConsultTurnResult.imageReadings に入る', async () => {
    const turn = await consultRecipe({ messages: [{ role: 'user', text: 'a' }] });
    expect(turn.imageReadings).toEqual(['reading2']);
  });

  it('toWireMessages の完了後に setTimeout（タイマー）が呼ばれる順序', async () => {
    const timerSpy = jest.spyOn(global, 'setTimeout');
    await consultRecipe({ messages: [{ role: 'user', text: 'a', imageUris: ['foo.jpg'] }] });
    // setTimeout は fetch の直前に呼ばれる
    // readAsStringAsync が呼ばれた（toWireMessages 中）後に setTimeout が呼ばれたことを確認する

    // global.setTimeout の呼び出しと readAsStringAsync の呼び出し順序をモックの invocationCallOrder で検証
    const readOrder = mockReadAsStringAsync.mock.invocationCallOrder[0];
    const timerOrder = timerSpy.mock.invocationCallOrder[0];
    expect(readOrder).toBeLessThan(timerOrder);
  });
});
