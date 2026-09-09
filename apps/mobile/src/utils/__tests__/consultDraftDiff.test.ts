import { diffConsultDraft } from '../consultDraftDiff';
import type { RecipeFormData } from '../../validation/recipe.schema';

const base = (over: Partial<RecipeFormData> = {}): RecipeFormData => ({
  title: '鶏むね肉のソテー',
  titleReading: '',
  description: '',
  servings: 2,
  cookTimeMin: 20,
  ingredients: [
    { groupLabel: '', name: '鶏むね肉', amount: '1枚', note: '' },
    { groupLabel: '', name: '塩', amount: '少々', note: '' },
    { groupLabel: '', name: 'オリーブオイル', amount: '大さじ1', note: '' },
  ],
  steps: [{ body: '鶏むね肉を切る' }, { body: '焼く' }, { body: '盛る' }],
  tags: [],
  ...over,
});

describe('diffConsultDraft — 相談の下書きが置き換わったときの差分要約（#303）', () => {
  it('初回は new', () => {
    expect(diffConsultDraft(null, base())).toEqual({ kind: 'new' });
  });

  it('同じ内容なら same（AI が「変えました」と言っても中身で判定する）', () => {
    expect(diffConsultDraft(base(), base())).toEqual({ kind: 'same' });
  });

  it('前後の空白・大文字小文字の違いだけなら same', () => {
    const next = base({
      title: ' 鶏むね肉のソテー ',
      ingredients: [
        { groupLabel: '', name: '鶏むね肉 ', amount: '1枚 ', note: '' },
        { groupLabel: '', name: '塩', amount: '少々', note: '' },
        { groupLabel: '', name: 'オリーブオイル', amount: '大さじ1', note: '' },
      ],
    });
    expect(diffConsultDraft(base(), next)).toEqual({ kind: 'same' });
  });

  it('4人分にすると servings と分量の変更が並ぶ', () => {
    const next = base({
      servings: 4,
      ingredients: [
        { groupLabel: '', name: '鶏むね肉', amount: '2枚', note: '' },
        { groupLabel: '', name: '塩', amount: '少々', note: '' },
        { groupLabel: '', name: 'オリーブオイル', amount: '大さじ2', note: '' },
      ],
    });
    expect(diffConsultDraft(base(), next)).toEqual({
      kind: 'changed',
      items: [
        { type: 'servings', from: 2, to: 4 },
        { type: 'ingredientsAdjusted', count: 2 },
      ],
    });
  });

  it('材料の追加・削除と手順の文言変更を拾う', () => {
    const next = base({
      ingredients: [
        { groupLabel: '', name: '鶏むね肉', amount: '1枚', note: '' },
        { groupLabel: '', name: 'オリーブオイル', amount: '大さじ1', note: '' },
        { groupLabel: '', name: 'にんにく', amount: '2かけ', note: '' },
      ],
      steps: [{ body: '鶏むね肉を切る' }, { body: 'にんにくと焼く' }, { body: '盛る' }],
    });
    expect(diffConsultDraft(base(), next)).toEqual({
      kind: 'changed',
      items: [
        { type: 'ingredientAdded', name: 'にんにく' },
        { type: 'ingredientRemoved', name: '塩' },
        { type: 'stepsEdited', count: 1 },
      ],
    });
  });

  it('手順の数が変わったら件数の変化として出す（文言比較はしない）', () => {
    const next = base({ steps: [{ body: '全部まとめて焼く' }] });
    expect(diffConsultDraft(base(), next)).toEqual({
      kind: 'changed',
      items: [{ type: 'stepsCount', from: 3, to: 1 }],
    });
  });

  it('同名の材料が複数行あっても、余った行を追加・足りない行を削除として拾う', () => {
    const prev = base({
      ingredients: [
        { groupLabel: '', name: '塩', amount: '小さじ1', note: '下味' },
        { groupLabel: '', name: '塩', amount: '少々', note: '仕上げ' },
      ],
    });
    const next = base({
      ingredients: [{ groupLabel: '', name: '塩', amount: '小さじ1', note: '下味' }],
    });
    expect(diffConsultDraft(prev, next)).toEqual({
      kind: 'changed',
      items: [{ type: 'ingredientRemoved', name: '塩' }],
    });
    expect(diffConsultDraft(next, prev)).toEqual({
      kind: 'changed',
      items: [{ type: 'ingredientAdded', name: '塩' }],
    });
  });

  it('「にんにく」と「ニンニク」、全角数字の分量は同じものとして扱う（買い物・在庫と同じ名寄せ）', () => {
    const prev = base({
      ingredients: [{ groupLabel: '', name: 'にんにく', amount: '大さじ1', note: '' }],
    });
    const next = base({
      ingredients: [{ groupLabel: '', name: 'ニンニク', amount: '大さじ１', note: '' }],
    });
    expect(diffConsultDraft(prev, next)).toEqual({ kind: 'same' });
  });

  it('頼んだ変更（追加・削除）が分量の微修正より先に並ぶ', () => {
    const next = base({
      servings: 4,
      ingredients: [
        { groupLabel: '', name: '鶏むね肉', amount: '2枚', note: '' },
        { groupLabel: '', name: 'オリーブオイル', amount: '大さじ2', note: '' },
        { groupLabel: '', name: 'にんにく', amount: '2かけ', note: '' },
      ],
    });
    expect(diffConsultDraft(base(), next)).toEqual({
      kind: 'changed',
      items: [
        { type: 'ingredientAdded', name: 'にんにく' },
        { type: 'ingredientRemoved', name: '塩' },
        { type: 'servings', from: 2, to: 4 },
        { type: 'ingredientsAdjusted', count: 2 },
      ],
    });
  });

  it('タイトルと時間の変更', () => {
    const next = base({ title: '鶏むね肉のピリ辛ソテー', cookTimeMin: 25 });
    expect(diffConsultDraft(base(), next)).toEqual({
      kind: 'changed',
      items: [
        { type: 'title', to: '鶏むね肉のピリ辛ソテー' },
        { type: 'cookTime', from: 20, to: 25 },
      ],
    });
  });
});
