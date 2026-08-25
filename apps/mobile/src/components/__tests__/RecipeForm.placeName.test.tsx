/**
 * お店の名前（v12）は**レシピ**が持つ。
 *
 * もともと店名は調理記録（`cooking_logs.place_name`）にしか無く、写真からレシピを作る
 * 初回にしか入力できなかった。記録に持たせると**後から入力しても過去の記録は直らない**
 * ため、レシピの属性に移した。「あとから足せる」「往復する」ことがその移行の要件。
 *
 * **2026-08-25 に契約を変えた（R1）**: 写真から作ると調理記録の既定が「お店で食べた」に
 * なるので、**あとから家/お店を切り替えられる**必要が出た。店名の欄は常時表示をやめ、
 * 「お店の料理」を選んだときだけ出す。家に戻したら店名は消す —
 * 「家の料理なのに店名がある」状態を作らないため。
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

const PLACEHOLDER = '例: 麻婆豆腐の○○屋（任意）';

describe('RecipeForm の「お店の料理 / 家の料理」', () => {
  it('店名が入っているレシピは**お店として開き**、名前が見える（編集から直せる）', () => {
    const { getByDisplayValue } = renderForm({ ...BASE, placeName: '○○屋' });
    expect(getByDisplayValue('○○屋')).toBeTruthy();
  });

  it('店名の無いレシピは家として開き、店名の欄は出さない', () => {
    const { queryByPlaceholderText } = renderForm(BASE);
    expect(queryByPlaceholderText(PLACEHOLDER)).toBeNull();
  });

  it('「お店の料理」に切り替えると欄が出て、あとから店名を足せる', () => {
    const { getByText, getByPlaceholderText, getByDisplayValue } = renderForm(BASE);
    fireEvent.press(getByText('お店の料理'));
    fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), '町中華の店');
    expect(getByDisplayValue('町中華の店')).toBeTruthy();
  });

  it('「家の料理」に戻すと店名を残さない（家なのに店名がある状態を作らない）', () => {
    const { getByText, queryByDisplayValue, queryByPlaceholderText } = renderForm({
      ...BASE,
      placeName: '○○屋',
    });
    fireEvent.press(getByText('家の料理'));
    expect(queryByPlaceholderText(PLACEHOLDER)).toBeNull();
    expect(queryByDisplayValue('○○屋')).toBeNull();
  });

  it('新規作成は家として開く（写真経由でない入口では店名を求めない）', () => {
    const { queryByPlaceholderText, getByText } = renderForm();
    expect(queryByPlaceholderText(PLACEHOLDER)).toBeNull();
    // ただし切り替えは常に見えている（あとから足せることが移行の要件）
    expect(getByText('お店の料理')).toBeTruthy();
  });
});
