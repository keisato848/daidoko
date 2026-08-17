/**
 * お店の名前（v12）は**レシピ**が持つ。
 *
 * もともと店名は調理記録（`cooking_logs.place_name`）にしか無く、写真からレシピを作る
 * 初回にしか入力できなかった。記録に持たせると**後から入力しても過去の記録は直らない**
 * ため、レシピの属性に移した。この欄が「常に出る」「往復する」ことがその移行の要件。
 */
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { RecipeForm } from '../RecipeForm';
import type { RecipeFormData } from '../../validation/recipe.schema';

jest.mock('../../services/tag.service', () => ({
  getTagsForFamily: jest.fn().mockResolvedValue([]),
}));

const noop = () => undefined;
const asyncNoop = async () => undefined;

function renderForm(initialValues?: RecipeFormData) {
  return render(
    <RecipeForm
      {...(initialValues ? { initialValues } : {})}
      onSubmit={asyncNoop}
      onCancel={noop}
      title="テスト"
    />,
  );
}

const BASE: RecipeFormData = {
  title: 'ガレット',
  titleReading: '',
  description: '',
  ingredients: [{ name: 'そば粉', amount: '100g', groupLabel: '', note: '' }],
  steps: [{ body: '焼く' }],
  tags: [],
};

describe('RecipeForm のお店の名前', () => {
  it('新規作成でも欄が出る（初回限定にしない — あとから足せることが目的）', () => {
    const { getByPlaceholderText } = renderForm();
    expect(getByPlaceholderText('例: 麻婆豆腐の○○屋（任意）')).toBeTruthy();
  });

  it('既存の値を読み込んで表示する（編集から直せる）', () => {
    const { getByDisplayValue } = renderForm({ ...BASE, placeName: '○○屋' });
    expect(getByDisplayValue('○○屋')).toBeTruthy();
  });

  it('未設定のレシピでも空欄で開き、入力できる', () => {
    const { getByPlaceholderText, getByDisplayValue } = renderForm(BASE);
    const field = getByPlaceholderText('例: 麻婆豆腐の○○屋（任意）');
    fireEvent.changeText(field, '町中華の店');
    expect(getByDisplayValue('町中華の店')).toBeTruthy();
  });
});
