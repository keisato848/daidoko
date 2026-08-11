/**
 * キーボードでボタンが隠れる問題の回帰止め。
 *
 * この構成では **`adjustResize` が効かず**ウィンドウがリサイズされない。
 * Android で `behavior` を未指定に戻すと `KeyboardAvoidingView` はただの View になり、
 * 画面下端のボタン（送信・保存・変換）がキーボードの下に完全に隠れる。
 * 実機 AQUOS SH-RM19s (Android 13) とエミュレータ API 36 の両方で再現した。
 */
import { render } from '@testing-library/react-native';
import React from 'react';
import { KeyboardAvoidingView, Text } from 'react-native';

import { KeyboardAvoider } from '../KeyboardAvoider';

describe('KeyboardAvoider', () => {
  it('behavior を padding で渡す（未指定にすると Android でボタンが隠れる）', () => {
    const tree = render(
      <KeyboardAvoider>
        <Text>child</Text>
      </KeyboardAvoider>,
    );
    const avoider = tree.UNSAFE_getByType(KeyboardAvoidingView);
    expect(avoider.props.behavior).toBe('padding');
  });

  it('子をそのまま描画する', () => {
    const tree = render(
      <KeyboardAvoider>
        <Text>child</Text>
      </KeyboardAvoider>,
    );
    expect(tree.getByText('child')).toBeTruthy();
  });

  it('offset を渡せる（ヘッダーぶんを差し引く画面向け）', () => {
    const tree = render(
      <KeyboardAvoider offset={54}>
        <Text>child</Text>
      </KeyboardAvoider>,
    );
    expect(tree.UNSAFE_getByType(KeyboardAvoidingView).props.keyboardVerticalOffset).toBe(54);
  });
});
