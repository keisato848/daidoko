/**
 * 読みがな欄は**日本語ロケールのときだけ**出す。
 *
 * 読みがなはかな検索のための欄で、英語 UI に出すと「Reading」という
 * 直訳ラベルだけが残り、フォーム全体の信頼を下げる
 * （1.12.2 のペルソナレビューで英語話者が指摘 — docs/reviews/persona/1.12.2.md #9。
 * ストア掲載スクショにも空欄のまま写るところだった）。
 *
 * 値そのものは保持される（ja に切り替えれば編集できる）。
 */
import { render, screen } from '@testing-library/react-native';

import { RecipeForm } from '../RecipeForm';
import { setLocale, t } from '../../i18n';

jest.mock('../../services/tag.service', () => ({
  getTagsForFamily: jest.fn(async () => []),
}));

// PhotoPickerField はネイティブの画像ピッカーに依存する。ここでは欄の有無しか見ない
jest.mock('../PhotoPickerField', () => ({
  PhotoPickerField: () => null,
}));

function renderForm() {
  return render(
    <RecipeForm onSubmit={jest.fn()} onCancel={jest.fn()} title={t('recipe.form.createTitle')} />,
  );
}

afterEach(() => {
  setLocale('ja');
});

describe('RecipeForm の読みがな欄', () => {
  it('ja では出る', () => {
    setLocale('ja');
    renderForm();
    expect(screen.getByText(t('recipe.form.readingLabel'))).toBeTruthy();
  });

  it('en では出ない（Reading の直訳ラベルを残さない）', () => {
    setLocale('en');
    const readingLabel = t('recipe.form.readingLabel');
    renderForm();
    expect(screen.queryByText(readingLabel)).toBeNull();
    // 欄そのものが消えているだけで、フォームは描画されている
    // （titleLabel は required で「*」が合成されるため、素のラベルで出る説明欄を見る）
    expect(screen.getByText(t('recipe.form.descriptionLabel'))).toBeTruthy();
  });
});
