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
