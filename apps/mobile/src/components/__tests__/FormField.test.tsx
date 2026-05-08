import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { FormField } from '../FormField';

describe('FormField', () => {
  it('ラベルを表示する', () => {
    render(<FormField label="レシピ名" value="" onChangeText={jest.fn()} />);
    expect(screen.getByText('レシピ名')).toBeTruthy();
  });

  it('required=true のとき「 *」を表示する', () => {
    render(<FormField label="タイトル" required value="" onChangeText={jest.fn()} />);
    expect(screen.getByText(' *')).toBeTruthy();
  });

  it('required=false のとき「 *」を表示しない', () => {
    render(<FormField label="説明" value="" onChangeText={jest.fn()} />);
    expect(screen.queryByText(' *')).toBeNull();
  });

  it('エラーメッセージを表示する', () => {
    render(<FormField label="レシピ名" value="" onChangeText={jest.fn()} error="必須項目です" />);
    expect(screen.getByText('必須項目です')).toBeTruthy();
  });

  it('エラーがなければエラーメッセージを表示しない', () => {
    render(<FormField label="レシピ名" value="" onChangeText={jest.fn()} />);
    expect(screen.queryByText('必須項目です')).toBeNull();
  });

  it('placeholder が TextInput に渡される', () => {
    render(
      <FormField label="レシピ名" value="" onChangeText={jest.fn()} placeholder="例: 肉じゃが" />,
    );
    expect(screen.getByPlaceholderText('例: 肉じゃが')).toBeTruthy();
  });
});
